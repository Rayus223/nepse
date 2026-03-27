import pkg from '@rumess/nepse-api';

const { Nepse, extractPageRange } = pkg;

const nepse = new Nepse();
nepse.setTLSVerification(false);

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_PAGE_COUNT = 5;
// A "zero" is a consecutive contract gap < 5.
// User rule: ignore runs with < 5 zeros => need at least 6 trades in the run.
const MIN_ZEROS = 5;
const MIN_SEQUENCE_LENGTH = MIN_ZEROS + 1;
const MAX_CONTRACT_GAP = 5;
const DEFAULT_TICK_SIZE = 0.1;
const DEFAULT_ZEROS_PER_STRENGTH = 10;

const DEFAULT_LOOKBACK = 'recent';
const LOOKBACK_TRADING_DAY_TARGET = {
    recent: 0,
    '1d': 1,
    '2d': 2,
    '3d': 3,
    '5d': 5,
    '1w': 5,
    '2w': 10,
    '3w': 15,
    '1m': 22,
    '2m': 44,
};

const LOOKBACK_MAX_PAGES = {
    recent: 5,
    '1d': 80,
    '2d': 140,
    '3d': 200,
    '5d': 320,
    '1w': 320,
    '2w': 640,
    '3w': 900,
    '1m': 1500,
    '2m': 2500,
};

const lastNonEmptyAnalysisByKey = new Map();

function toNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function toMillis(isoTime) {
    if (!isoTime) return null;
    const parsed = Date.parse(isoTime);
    return Number.isNaN(parsed) ? null : parsed;
}

function normalizeTrade(trade, globalIndex) {
    return {
        sn: globalIndex + 1,
        contractNo: toNumber(trade.contractId),
        stockSymbol: trade.stockSymbol?.toUpperCase() || '',
        buyerId: trade.buyerMemberId || null,
        sellerId: trade.sellerMemberId || null,
        quantity: toNumber(trade.contractQuantity) ?? 0,
        rate: toNumber(trade.contractRate) ?? 0,
        amount: toNumber(trade.contractAmount) ?? 0,
        businessDate: trade.businessDate || null,
        tradeTime: trade.tradeTime || null,
        tradeTimeMs: toMillis(trade.tradeTime),
        securityName: trade.securityName || trade.stockSymbol?.toUpperCase() || '',
        buyerBrokerName: trade.buyerBrokerName || null,
        sellerBrokerName: trade.sellerBrokerName || null,
        raw: trade,
    };
}

function groupTradesBySymbol(trades) {
    const grouped = new Map();

    trades.forEach((trade) => {
        if (!trade.stockSymbol) return;
        if (!grouped.has(trade.stockSymbol)) {
            grouped.set(trade.stockSymbol, []);
        }
        grouped.get(trade.stockSymbol).push(trade);
    });

    for (const [symbol, symbolTrades] of grouped.entries()) {
        // NEPSE time order: oldest -> newest (so "lastRate" is truly most recent).
        // If tradeTime is missing, fall back to fetched S.N. order.
        symbolTrades.sort((a, b) => {
            const timeStrA = a.tradeTime ?? null;
            const timeStrB = b.tradeTime ?? null;
            if (timeStrA !== null && timeStrB !== null && timeStrA !== timeStrB) {
                // Includes microseconds; lexical order matches chronological order.
                return timeStrA.localeCompare(timeStrB);
            }

            const timeA = a.tradeTimeMs ?? null;
            const timeB = b.tradeTimeMs ?? null;
            if (timeA !== null && timeB !== null && timeA !== timeB) return timeA - timeB;
            if (timeA === null && timeB !== null) return -1;
            if (timeA !== null && timeB === null) return 1;
            return a.sn - b.sn;
        });
        grouped.set(symbol, symbolTrades);
    }

    return grouped;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function computeVolumeWeight(totalQuantity) {
    // Normalizes around ~10k quantity -> weight ~1, clamps extremes.
    const raw = Math.log10(1 + (Number(totalQuantity) || 0)) / 4;
    return clamp(raw, 0.25, 2.5);
}

function classifySequence(sequence, options) {
    const firstTrade = sequence[0];
    const lastTrade = sequence[sequence.length - 1];

    const tickSize = Number(options?.tickSize) > 0 ? Number(options.tickSize) : DEFAULT_TICK_SIZE;
    const zerosPerStrength = Number(options?.zerosPerStrength) > 0 ? Number(options.zerosPerStrength) : DEFAULT_ZEROS_PER_STRENGTH;

    const zeros = Math.max(0, sequence.length - 1);
    const baseStrength = zeros / zerosPerStrength;
    const totalQuantity = sequence.reduce((sum, trade) => sum + trade.quantity, 0);
    const volumeWeight = computeVolumeWeight(totalQuantity);
    const delta = Number((lastTrade.rate - firstTrade.rate).toFixed(2));

    let signal = 'Large Block Trade';
    let direction = 'flat';
    let strength = 0;

    if (Math.abs(delta) <= tickSize) {
        signal = 'Large Block Trade';
        direction = 'flat';
        strength = 0;
    } else if (delta > 0) {
        signal = 'Aggressive Buying';
        direction = 'buying';
        strength = Number((baseStrength * volumeWeight).toFixed(2));
    } else {
        signal = 'Aggressive Selling';
        direction = 'selling';
        strength = Number((-baseStrength * volumeWeight).toFixed(2));
    }

    return {
        signal,
        direction,
        firstRate: firstTrade.rate,
        lastRate: lastTrade.rate,
        rateChange: delta,
        zeros,
        baseStrength: Number(baseStrength.toFixed(2)),
        volumeWeight: Number(volumeWeight.toFixed(2)),
        strength,
        runLength: sequence.length,
        startContractNo: firstTrade.contractNo,
        endContractNo: lastTrade.contractNo,
        totalQuantity,
        totalAmount: Number(sequence.reduce((sum, trade) => sum + trade.amount, 0).toFixed(2)),
        trades: sequence,
        firstTradeTime: firstTrade.tradeTime,
        lastTradeTime: lastTrade.tradeTime,
        contractDiffs: sequence.slice(1).map((trade, index) => ({
            fromContractNo: sequence[index].contractNo,
            toContractNo: trade.contractNo,
            difference: Math.abs((sequence[index].contractNo ?? 0) - (trade.contractNo ?? 0)),
        })),
    };
}

function detectSequences(symbol, trades) {
    const signals = [];
    let currentRun = trades.length > 0 ? [trades[0]] : [];

    for (let i = 1; i < trades.length; i++) {
        const previousTrade = trades[i - 1];
        const currentTrade = trades[i];
        const contractGap = Math.abs((previousTrade.contractNo ?? 0) - (currentTrade.contractNo ?? 0));

        if (contractGap < MAX_CONTRACT_GAP) {
            currentRun.push(currentTrade);
            continue;
        }

        if (currentRun.length >= MIN_SEQUENCE_LENGTH) {
            signals.push({
                symbol,
                securityName: currentRun[0].securityName,
                ...classifySequence(currentRun),
            });
        }

        currentRun = [currentTrade];
    }

    if (currentRun.length >= MIN_SEQUENCE_LENGTH) {
        signals.push({
            symbol,
            securityName: currentRun[0].securityName,
            ...classifySequence(currentRun),
        });
    }

    return signals;
}

function buildDashboardSignals(groupedTrades) {
    const allSignals = [];

    for (const [symbol, trades] of groupedTrades.entries()) {
        const symbolSignals = detectSequences(symbol, trades);
        allSignals.push(...symbolSignals);
    }

    return allSignals.sort((a, b) => {
        const absA = Math.abs(a.strength ?? 0);
        const absB = Math.abs(b.strength ?? 0);
        if (absB !== absA) return absB - absA;
        if (b.zeros !== a.zeros) return (b.zeros ?? 0) - (a.zeros ?? 0);
        if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
        return (b.endContractNo ?? 0) - (a.endContractNo ?? 0);
    });
}

export async function getLiveFloorsheetAnalysis(options = {}) {
    const pageSize = Number(options.pageSize) > 0 ? Number(options.pageSize) : DEFAULT_PAGE_SIZE;
    const pageCount = Number(options.pageCount) > 0 ? Number(options.pageCount) : DEFAULT_PAGE_COUNT;
    const tickSize = Number(options.tickSize) > 0 ? Number(options.tickSize) : DEFAULT_TICK_SIZE;
    const zerosPerStrength = Number(options.zerosPerStrength) > 0 ? Number(options.zerosPerStrength) : DEFAULT_ZEROS_PER_STRENGTH;
    const lookback = typeof options.lookback === 'string' ? options.lookback : DEFAULT_LOOKBACK;
    const targetDays = LOOKBACK_TRADING_DAY_TARGET[lookback] ?? LOOKBACK_TRADING_DAY_TARGET[DEFAULT_LOOKBACK];
    const maxPages = LOOKBACK_MAX_PAGES[lookback] ?? LOOKBACK_MAX_PAGES[DEFAULT_LOOKBACK];

    let pages = [];
    if (lookback === 'recent' || targetDays === 0) {
        const effectivePages = Math.min(pageCount, maxPages);
        pages = await extractPageRange(
            0,
            effectivePages,
            (page) => nepse.getFloorSheet({ page, size: pageSize }).then((result) => result.floorsheets),
            { delayBetweenRequests: 0 }
        );
    } else {
        const collected = [];
        const businessDates = new Set();
        const maxPagesToFetch = Math.max(1, maxPages);

        for (let page = 0; page < maxPagesToFetch; page++) {
            const response = await nepse.getFloorSheet({ page, size: pageSize });
            const content = response?.floorsheets?.content || [];
            if (content.length === 0) break;

            collected.push(...content);
            content.forEach((trade) => {
                if (trade?.businessDate) businessDates.add(trade.businessDate);
            });

            if (businessDates.size >= targetDays) break;
        }

        pages = collected;
    }

    const normalizedTrades = pages.map((trade, index) => normalizeTrade(trade, index));
    const groupedTrades = groupTradesBySymbol(normalizedTrades);
    const signals = buildDashboardSignals(groupedTrades).map((signal) => ({
        ...signal,
        // Recompute using configured options (tick size, zeros scaling).
        ...classifySequence(signal.trades, { tickSize, zerosPerStrength })
    }));

    const groupedSummary = Array.from(groupedTrades.entries()).map(([symbol, trades]) => ({
        symbol,
        securityName: trades[0]?.securityName || symbol,
        tradeCount: trades.length,
        latestContractNo: trades[0]?.contractNo ?? null,
        latestRate: trades[0]?.rate ?? null,
    })).sort((a, b) => a.symbol.localeCompare(b.symbol));

    const key = `${lookback}:${pageSize}:${pageCount}:${tickSize}:${zerosPerStrength}`;
    const businessDatesCovered = Array.from(new Set(normalizedTrades.map((trade) => trade.businessDate).filter(Boolean))).sort();

    const result = {
        success: true,
        meta: {
            fetchedTrades: normalizedTrades.length,
            scannedSymbols: groupedTrades.size,
            pageSize,
            pageCount,
            lookback,
            tradingDaysCovered: businessDatesCovered.length,
            businessDatesCovered,
            minSequenceLength: MIN_SEQUENCE_LENGTH,
            maxContractGapExclusive: MAX_CONTRACT_GAP,
            tickSize,
            zerosPerStrength,
            generatedAt: new Date().toISOString(),
        },
        signals,
        groupedSummary,
        trades: normalizedTrades,
    };

    if (Array.isArray(result.signals) && result.signals.length > 0) {
        lastNonEmptyAnalysisByKey.set(key, result);
        return result;
    }

    const cached = lastNonEmptyAnalysisByKey.get(key);
    if (cached) {
        return {
            ...cached,
            meta: {
                ...cached.meta,
                stale: true,
                generatedAt: new Date().toISOString(),
            }
        };
    }

    return result;
}
