import pkg from '@rumess/nepse-api';
import { broadcastMarketStatus, broadcastTickUpdate } from '../websocket/wsServer.js';

const { Nepse, apiEndpoints, extractAllPages } = pkg;

const POLL_INTERVAL_MS = 10000;
const HISTORY_LIMIT = 500;

const nepse = new Nepse();
nepse.setTLSVerification(false);

let isMarketOpen = false;
let marketSummary = null;
const stockCache = new Map();
const historyCache = new Map();
let securityUniverseCache = null;

export const getMarketSummary = () => marketSummary;
export const getStockState = (symbol) => stockCache.get(symbol);
export const getAllStocksState = () => Object.fromEntries(stockCache);
export const getSecurityUniverse = async () => {
    if (!securityUniverseCache) {
        const securities = await nepse.getSecurityList();
        securityUniverseCache = securities
            .filter((item) => item?.symbol)
            .map((item) => ({
                symbol: item.symbol.toUpperCase(),
                securityName: item.securityName || item.name || item.symbol.toUpperCase(),
                activeStatus: item.activeStatus || null
            }))
            .sort((a, b) => a.symbol.localeCompare(b.symbol));
    }

    return securityUniverseCache;
};
export const ensureMarketDataReady = async () => {
    if (stockCache.size === 0 || marketSummary === null) {
        await refreshAllMarketData();
    }
};

export const startNepsePolling = async () => {
    console.log(`Starting NEPSE polling service (Interval: ${POLL_INTERVAL_MS}ms)`);

    await refreshAllMarketData();

    setInterval(async () => {
        try {
            await refreshAllMarketData();
        } catch (error) {
            console.error('Polling error:', error.message);
        }
    }, POLL_INTERVAL_MS);
};

async function refreshAllMarketData() {
    await Promise.all([
        fetchMarketStatus(),
        fetchMarketSummary(),
        fetchLiveMarket()
    ]);
}

async function fetchMarketStatus() {
    try {
        const status = await nepse.getMarketStatus();
        const nextStatus = typeof status?.isOpen === 'string'
            ? status.isOpen.toUpperCase() === 'OPEN'
            : Boolean(status?.isOpen);

        isMarketOpen = nextStatus;
        broadcastMarketStatus({
            isOpen: isMarketOpen,
            asOf: status?.asOf || new Date().toISOString()
        });
    } catch (error) {
        console.error('Error fetching market status', error.message);
    }
}

async function fetchMarketSummary() {
    try {
        marketSummary = await nepse.getMarketSummary();
    } catch (error) {
        console.error('Error fetching market summary', error.message);
    }
}

async function fetchLiveMarket() {
    try {
        const liveMarket = await nepse.getLiveMarket();

        for (const item of liveMarket) {
            const symbol = item.symbol?.toUpperCase();
            if (!symbol) continue;

            const nextState = mapLiveMarketItem(item);
            const previousState = stockCache.get(symbol);
            stockCache.set(symbol, nextState);

            if (hasMeaningfulTickChange(previousState, nextState)) {
                broadcastTickUpdate({
                    symbol,
                    price: nextState.lastPrice,
                    change: nextState.change,
                    percentChange: nextState.percentChange,
                    candle: nextState.candle
                });
            }
        }
    } catch (error) {
        console.error('Error fetching live market data', error.message);
    }
}

function hasMeaningfulTickChange(previousState, nextState) {
    if (!previousState) return true;

    return previousState.lastPrice !== nextState.lastPrice
        || previousState.change !== nextState.change
        || previousState.percentChange !== nextState.percentChange
        || previousState.updatedAt !== nextState.updatedAt;
}

function mapLiveMarketItem(item) {
    const previousClose = toNumber(item.previousClose);
    const lastPrice = toNumber(item.lastTradedPrice);
    const change = previousClose === null || lastPrice === null
        ? 0
        : Number((lastPrice - previousClose).toFixed(2));
    const percentChange = item.percentageChange !== undefined && item.percentageChange !== null
        ? Number(item.percentageChange)
        : previousClose
            ? Number(((change / previousClose) * 100).toFixed(2))
            : 0;

    return {
        symbol: item.symbol?.toUpperCase(),
        securityName: item.securityName || item.symbol?.toUpperCase(),
        lastPrice: lastPrice ?? 0,
        change,
        percentChange,
        prevClose: previousClose ?? 0,
        updatedAt: item.lastUpdatedDateTime || null,
        candle: {
            time: toUnixTime(item.lastUpdatedDateTime),
            open: toNumber(item.openPrice) ?? lastPrice ?? 0,
            high: toNumber(item.highPrice) ?? lastPrice ?? 0,
            low: toNumber(item.lowPrice) ?? lastPrice ?? 0,
            close: lastPrice ?? 0,
            volume: toNumber(item.totalTradeQuantity) ?? 0
        }
    };
}

function toUnixTime(dateTimeString) {
    if (!dateTimeString) {
        return Math.floor(Date.now() / 1000);
    }

    const normalized = String(dateTimeString).replace(' ', 'T');
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
}

function toNumber(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function toBusinessDateUnix(dateString) {
    const parsed = Date.parse(`${dateString}T00:00:00Z`);
    return Number.isNaN(parsed) ? Math.floor(Date.now() / 1000) : Math.floor(parsed / 1000);
}

function mapHistoryRow(row) {
    return {
        time: toBusinessDateUnix(row.businessDate),
        open: toNumber(row.openPrice) ?? toNumber(row.closePrice) ?? 0,
        high: toNumber(row.highPrice) ?? toNumber(row.closePrice) ?? 0,
        low: toNumber(row.lowPrice) ?? toNumber(row.closePrice) ?? 0,
        close: toNumber(row.closePrice) ?? toNumber(row.lastTradedPrice) ?? 0,
        volume: toNumber(row.totalTradedQuantity) ?? 0
    };
}

export const getStockHistory = async (symbol) => {
    const cacheKey = symbol.toUpperCase();
    const cached = historyCache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < POLL_INTERVAL_MS) {
        return cached.candles;
    }

    const securityId = (await nepse.getSecuritySymbolIdKeymap()).get(cacheKey);
    if (!securityId) {
        throw new Error(`Security symbol ${cacheKey} not found`);
    }

    const historyRows = await extractAllPages(
        (page) => nepse.requestGETAPI(`${apiEndpoints.security_price_volume_history}${securityId}?page=${page}`),
        { delayBetweenRequests: 0 }
    );

    const candles = historyRows
        .map(mapHistoryRow)
        .filter((candle) => candle.close > 0)
        .sort((a, b) => a.time - b.time)
        .slice(-HISTORY_LIMIT);

    const liveState = stockCache.get(cacheKey);
    if (liveState && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        const liveCandle = liveState.candle;

        if (liveCandle && liveCandle.time >= lastCandle.time) {
            candles[candles.length - 1] = {
                ...lastCandle,
                high: Math.max(lastCandle.high, liveCandle.high),
                low: Math.min(lastCandle.low, liveCandle.low),
                close: liveState.lastPrice,
                volume: liveCandle.volume || lastCandle.volume
            };
        }
    }

    historyCache.set(cacheKey, {
        fetchedAt: Date.now(),
        candles
    });

    return candles;
};
