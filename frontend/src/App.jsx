import React, { useEffect, useMemo, useState } from 'react';
import CandlestickChart from './components/chart/CandlestickChart';
import RSIPanel from './components/indicators/RSIPanel';
import { useWebSocket } from './hooks/useWebSocket';
import { useMarketStore } from './store/marketStore';
import { marketApi } from './services/api';
import './styles/globals.css';

const TIMEFRAMES = ['5m', '15m', '1h', '4h', 'D', 'W'];
const LEFT_TOOLS = ['+', 'TL', 'Fx', 'RSI', 'Fib', 'Txt', 'Mag', 'Pin', 'Eye'];

function formatCompactNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  return Number(value).toFixed(2);
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '--';
  const amount = Number(value);
  return `${amount >= 0 ? '+' : ''}${amount.toFixed(2)}%`;
}

const LOOKBACK_OPTIONS = [
  { value: 'recent', label: 'Recent' },
  { value: '1d', label: '1 Day' },
  { value: '2d', label: '2 Day' },
  { value: '3d', label: '3 Day' },
  { value: '5d', label: '5 Day' },
  { value: '1w', label: '1 Week' },
  { value: '2w', label: '2 Week' },
  { value: '3w', label: '3 Week' },
  { value: '1m', label: '1 Month' },
  { value: '2m', label: '2 Month' },
];

function lookbackLabel(value) {
  return LOOKBACK_OPTIONS.find((item) => item.value === value)?.label || 'Recent';
}

function signalColor(signal) {
  if (signal === 'Aggressive Buying') return 'var(--accent-green)';
  if (signal === 'Aggressive Selling') return 'var(--accent-red)';
  return 'var(--accent-blue)';
}

function signalBackground(signal) {
  if (signal === 'Aggressive Buying') return 'var(--accent-green-bg)';
  if (signal === 'Aggressive Selling') return 'var(--accent-red-bg)';
  return 'rgba(88, 166, 255, 0.12)';
}

function buildSignalTradeRows(signals) {
  return signals.flatMap((signal, signalIndex) => (
    signal.trades.map((trade, tradeIndex) => ({
      key: `${signal.symbol}-${signal.startContractNo}-${trade.contractNo}-${tradeIndex}`,
      signalIndex,
      signal: signal.signal,
      symbol: signal.symbol,
      securityName: signal.securityName,
      sn: trade.sn,
      contractNo: trade.contractNo,
      buyerId: trade.buyerId || '--',
      sellerId: trade.sellerId || '--',
      quantity: trade.quantity,
      rate: trade.rate,
      amount: trade.amount,
      tradeTime: trade.tradeTime,
      differenceFromPrevious: tradeIndex === 0
        ? '--'
        : Math.abs((signal.trades[tradeIndex - 1].contractNo ?? 0) - (trade.contractNo ?? 0)),
      runLength: signal.runLength,
      firstRate: signal.firstRate,
      lastRate: signal.lastRate,
    }))
  ));
}

function SideSignalList({
  title,
  emptyText,
  signals,
  selectedSymbol,
  onSelectSymbol,
  accent,
  lookback,
  setLookback,
}) {
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  return (
    <section style={styles.sidePanel}>
      <div style={styles.sidePanelHeader}>
        <div>
          <div style={{ ...styles.sidePanelTitle, color: accent }}>{title}</div>
          <div style={styles.sidePanelSubtitle}>Live floorsheet pressure detection · {signals.length}</div>
        </div>
        <div style={styles.sidePanelFilterWrap}>
          <button
            type="button"
            style={{ ...styles.sidePanelFilterButton, borderColor: accent, color: accent }}
            onClick={() => setIsFilterOpen((value) => !value)}
            title="Select lookback window"
          >
            {lookbackLabel(lookback)}
          </button>
          {isFilterOpen && (
            <div style={styles.sidePanelFilterDropdown}>
              {LOOKBACK_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  style={styles.sidePanelFilterOption}
                  onClick={() => {
                    setLookback(option.value);
                    setIsFilterOpen(false);
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.sidePanelBody}>
        {signals.length === 0 ? (
          <div style={styles.emptyState}>{emptyText}</div>
        ) : (
          signals.map((signal, index) => (
            <button
              key={`${signal.symbol}-${signal.startContractNo}-${index}`}
              type="button"
              onClick={() => onSelectSymbol(signal.symbol)}
              style={{
                ...styles.signalListCard,
                ...(signal.symbol === selectedSymbol ? styles.signalListCardActive : null),
              }}
            >
              <div style={styles.signalListTop}>
                <div>
                  <div style={styles.signalListSymbol}>{signal.symbol}</div>
                  <div style={styles.signalListName}>{signal.securityName}</div>
                </div>
                <div
                  style={{
                    ...styles.signalPill,
                    color: signalColor(signal.signal),
                    background: signalBackground(signal.signal),
                    borderColor: signalColor(signal.signal),
                  }}
                >
                  {signal.signal}
                </div>
              </div>

              <div style={styles.signalListStats}>
                <span>Run {signal.runLength}</span>
                <span>{formatPrice(signal.firstRate)} {'->'} {formatPrice(signal.lastRate)}</span>
              </div>

              <div style={styles.signalListStats}>
                <span>Qty {formatCompactNumber(signal.totalQuantity)}</span>
                <span>Amt {formatCompactNumber(signal.totalAmount)}</span>
              </div>

              <div style={styles.signalListStats}>
                <span style={{ color: signalColor(signal.signal), fontWeight: 800 }}>
                  Strength {signal.strength >= 0 ? '+' : ''}{formatPrice(signal.strength)}
                </span>
                <span style={styles.signalListMuted}>Zeros {signal.zeros ?? '--'}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function TopSymbolSearch({ companies, value, query, setQuery, onSelectSymbol }) {
  const filteredCompanies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return companies.slice(0, 12);

    return companies
      .filter((item) =>
        item.symbol.toLowerCase().includes(normalizedQuery) ||
        item.securityName?.toLowerCase().includes(normalizedQuery)
      )
      .slice(0, 12);
  }, [companies, query]);

  return (
    <div style={styles.topSearchWrap}>
      <div style={styles.topSearchBox}>
        <span style={styles.searchIcon}>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={value}
          style={styles.topSearchInput}
        />
      </div>

      {query.trim() && (
        <div style={styles.topSearchDropdown}>
          {filteredCompanies.length === 0 ? (
            <div style={styles.topSearchEmpty}>No matching company</div>
          ) : (
            filteredCompanies.map((company) => (
              <button
                key={company.symbol}
                type="button"
                onClick={() => {
                  onSelectSymbol(company.symbol);
                  setQuery('');
                }}
                style={styles.topSearchOption}
              >
                <span style={styles.topSearchOptionSymbol}>{company.symbol}</span>
                <span style={styles.topSearchOptionName}>{company.securityName || company.symbol}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FloorsheetDashboard({ floorsheetData, floorsheetLoading, floorsheetError, selectedSymbol, onSelectSymbol }) {
  const signals = floorsheetData?.signals || [];
  const buyingSignals = signals.filter((signal) => signal.signal === 'Aggressive Buying');
  const sellingSignals = signals.filter((signal) => signal.signal === 'Aggressive Selling');
  const blockSignals = signals.filter((signal) => signal.signal === 'Large Block Trade');
  const selectedSignals = signals.filter((signal) => signal.symbol === selectedSymbol);
  const visibleSignals = selectedSignals.length > 0 ? selectedSignals : signals;
  const signalTradeRows = buildSignalTradeRows(visibleSignals);

  return (
    <div style={styles.floorsheetDashboard}>
      <div style={styles.floorsheetHero}>
        <div>
          <div style={styles.floorsheetTitle}>Floorsheet Analysis Dashboard</div>
          <div style={styles.floorsheetSubtitle}>
            Live NEPSE contract clustering, zero-gap subtraction, and rate direction analysis
          </div>
        </div>
        <div style={styles.floorsheetMeta}>
          <span>{floorsheetLoading ? 'Refreshing live data...' : `${floorsheetData?.meta?.fetchedTrades || 0} recent trades scanned`}</span>
          <span>{floorsheetData?.meta ? `Gap < ${floorsheetData.meta.maxContractGapExclusive}` : 'Gap rule loading'}</span>
        </div>
      </div>

      <div style={styles.floorsheetSummaryGrid}>
        <div style={styles.floorsheetSummaryCard}>
          <div style={styles.floorsheetSummaryLabel}>Buying Signals</div>
          <div style={styles.floorsheetSummaryValue}>{buyingSignals.length}</div>
        </div>
        <div style={styles.floorsheetSummaryCard}>
          <div style={styles.floorsheetSummaryLabel}>Selling Signals</div>
          <div style={styles.floorsheetSummaryValue}>{sellingSignals.length}</div>
        </div>
        <div style={styles.floorsheetSummaryCard}>
          <div style={styles.floorsheetSummaryLabel}>Block Trades</div>
          <div style={styles.floorsheetSummaryValue}>{blockSignals.length}</div>
        </div>
        <div style={styles.floorsheetSummaryCard}>
          <div style={styles.floorsheetSummaryLabel}>Tracked Symbol</div>
          <div style={styles.floorsheetSummaryValue}>{selectedSymbol}</div>
        </div>
      </div>

      <div style={styles.floorsheetMainGrid}>
        <section style={styles.floorsheetPanelLarge}>
          <div style={styles.panelLabelRow}>
            <span style={styles.panelTitle}>Detected Signal Runs</span>
            <span style={styles.panelHint}>Click a symbol to filter the spreadsheet rows below</span>
          </div>
          <div style={styles.tableWrap}>
            {floorsheetError ? (
              <div style={styles.emptyState}>{floorsheetError}</div>
            ) : visibleSignals.length === 0 ? (
              <div style={styles.emptyState}>No signal runs detected in the recent live floorsheet window.</div>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Symbol</th>
                    <th style={styles.th}>Signal</th>
                    <th style={styles.th}>Run</th>
                    <th style={styles.th}>Start Contract</th>
                    <th style={styles.th}>End Contract</th>
                    <th style={styles.th}>First Rate</th>
                    <th style={styles.th}>Last Rate</th>
                    <th style={styles.th}>Total Qty</th>
                    <th style={styles.th}>Total Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSignals.map((signal, index) => (
                    <tr key={`${signal.symbol}-${signal.startContractNo}-${index}`} style={styles.trClickable} onClick={() => onSelectSymbol(signal.symbol)}>
                      <td style={styles.td}>{signal.symbol}</td>
                      <td style={{ ...styles.td, color: signalColor(signal.signal), fontWeight: 700 }}>{signal.signal}</td>
                      <td style={styles.td}>{signal.runLength}</td>
                      <td style={styles.td}>{signal.startContractNo}</td>
                      <td style={styles.td}>{signal.endContractNo}</td>
                      <td style={styles.td}>{formatPrice(signal.firstRate)}</td>
                      <td style={styles.td}>{formatPrice(signal.lastRate)}</td>
                      <td style={styles.td}>{formatCompactNumber(signal.totalQuantity)}</td>
                      <td style={styles.td}>{formatCompactNumber(signal.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section style={styles.floorsheetPanelSide}>
          <div style={styles.panelLabelRow}>
            <span style={styles.panelTitle}>Live Detected Symbols</span>
            <span style={styles.panelHint}>Recent flags</span>
          </div>
          <div style={styles.sidePanelBody}>
            {signals.slice(0, 20).map((signal, index) => (
              <button
                key={`${signal.symbol}-${signal.startContractNo}-${index}-sidebar`}
                type="button"
                onClick={() => onSelectSymbol(signal.symbol)}
                style={{
                  ...styles.signalListCard,
                  ...(signal.symbol === selectedSymbol ? styles.signalListCardActive : null),
                }}
              >
                <div style={styles.signalListTop}>
                  <div style={styles.signalListSymbol}>{signal.symbol}</div>
                  <div
                    style={{
                      ...styles.signalPill,
                      color: signalColor(signal.signal),
                      background: signalBackground(signal.signal),
                      borderColor: signalColor(signal.signal),
                    }}
                  >
                    {signal.signal}
                  </div>
                </div>
                <div style={styles.signalListStats}>
                  <span>Run {signal.runLength}</span>
                  <span>{formatPrice(signal.firstRate)} {'->'} {formatPrice(signal.lastRate)}</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section style={styles.floorsheetPanelFull}>
        <div style={styles.panelLabelRow}>
          <span style={styles.panelTitle}>Spreadsheet Detail</span>
          <span style={styles.panelHint}>S.N., Contract No., subtraction gap, buyer, seller, quantity, rate, amount</span>
        </div>
        <div style={styles.tableWrapTall}>
          {signalTradeRows.length === 0 ? (
            <div style={styles.emptyState}>Select a detected symbol or wait for live floorsheet signals to appear.</div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Signal</th>
                  <th style={styles.th}>S.N.</th>
                  <th style={styles.th}>Symbol</th>
                  <th style={styles.th}>Contract No.</th>
                  <th style={styles.th}>Diff</th>
                  <th style={styles.th}>Buyer</th>
                  <th style={styles.th}>Seller</th>
                  <th style={styles.th}>Qty</th>
                  <th style={styles.th}>Rate</th>
                  <th style={styles.th}>Amount</th>
                  <th style={styles.th}>Time</th>
                  <th style={styles.th}>First Rate</th>
                  <th style={styles.th}>Last Rate</th>
                  <th style={styles.th}>Run</th>
                </tr>
              </thead>
              <tbody>
                {signalTradeRows.map((row) => (
                  <tr key={row.key}>
                    <td style={{ ...styles.td, color: signalColor(row.signal), fontWeight: 700 }}>{row.signal}</td>
                    <td style={styles.td}>{row.sn}</td>
                    <td style={styles.td}>{row.symbol}</td>
                    <td style={styles.td}>{row.contractNo}</td>
                    <td style={styles.td}>{row.differenceFromPrevious}</td>
                    <td style={styles.td}>{row.buyerId}</td>
                    <td style={styles.td}>{row.sellerId}</td>
                    <td style={styles.td}>{row.quantity}</td>
                    <td style={styles.td}>{formatPrice(row.rate)}</td>
                    <td style={styles.td}>{formatCompactNumber(row.amount)}</td>
                    <td style={styles.td}>{row.tradeTime?.slice(11, 19) || '--'}</td>
                    <td style={styles.td}>{formatPrice(row.firstRate)}</td>
                    <td style={styles.td}>{formatPrice(row.lastRate)}</td>
                    <td style={styles.td}>{row.runLength}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function TradingDashboard({
  selectedSymbol,
  selectedStock,
  candles,
  companies,
  topSearchQuery,
  setTopSearchQuery,
  activeTimeframe,
  setActiveTimeframe,
  theme,
  toggleTheme,
  isConnected,
  isMarketOpen,
  buyingSignals,
  sellingSignals,
  onSelectSymbol,
  onOpenFloorsheet,
  lookback,
  setLookback,
}) {
  const latestCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const previousCandle = candles.length > 1 ? candles[candles.length - 2] : null;
  const volumeText = latestCandle ? formatCompactNumber(latestCandle.volume) : '--';
  const candleChange = latestCandle && previousCandle
    ? latestCandle.close - previousCandle.close
    : selectedStock?.change ?? 0;
  const candlePercent = previousCandle?.close
    ? (candleChange / previousCandle.close) * 100
    : selectedStock?.percentChange ?? 0;

  const toolbarActions = [
    { label: 'Indicators' },
    { label: 'Draw' },
    { label: 'Replay' },
    { label: 'Floorsheet', onClick: onOpenFloorsheet },
  ];

  return (
    <div style={styles.appContainer}>
      <header style={styles.topToolbar}>
        <div style={styles.topToolbarLeft}>
          <TopSymbolSearch
            companies={companies}
            value={selectedSymbol}
            query={topSearchQuery}
            setQuery={setTopSearchQuery}
            onSelectSymbol={onSelectSymbol}
          />

          <div style={styles.timeframeGroup}>
            {TIMEFRAMES.map((timeframe) => (
              <button
                key={timeframe}
                type="button"
                onClick={() => setActiveTimeframe(timeframe)}
                style={{
                  ...styles.timeframeButton,
                  ...(timeframe === activeTimeframe ? styles.timeframeButtonActive : null),
                }}
              >
                {timeframe}
              </button>
            ))}
          </div>

          <div style={styles.actionGroup}>
            {toolbarActions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                style={styles.actionButton}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>

        <div style={styles.topToolbarRight}>
          <div style={styles.streamBadge(isConnected)}>
            {isConnected ? 'Stream Online' : 'Stream Offline'}
          </div>
          <div style={styles.marketBadge(isMarketOpen)}>
            {isMarketOpen ? 'Market Open' : 'Market Closed'}
          </div>
          <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <div style={styles.mainAreaNoStrip}>
        <SideSignalList
          title="Buying Shares"
          emptyText="No aggressive buying clusters detected right now."
          signals={buyingSignals}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={onSelectSymbol}
          accent="var(--accent-green)"
          lookback={lookback}
          setLookback={setLookback}
        />

        <main style={styles.workspace}>
          <div style={styles.chartStackShell}>
            <div style={styles.leftToolRail}>
              {LEFT_TOOLS.map((tool) => (
                <button key={tool} type="button" style={styles.toolButton}>{tool}</button>
              ))}
            </div>

            <div style={styles.chartWorkspace}>
              <section style={styles.chartShell}>
                <div style={styles.chartHeader}>
                  <div style={styles.chartTitleBlock}>
                    <div style={styles.chartTitleLine}>
                      <span style={styles.chartSymbol}>{selectedSymbol}</span>
                      <span style={styles.chartName}>{selectedStock?.securityName || 'Selected Security'}</span>
                      <span style={styles.chartTimeframe}>· {activeTimeframe}</span>
                    </div>
                    <div style={styles.chartSubMeta}>
                      <span>Volume {volumeText}</span>
                      <span>Close {formatPrice(latestCandle?.close ?? selectedStock?.lastPrice)}</span>
                    </div>
                  </div>

                  <div style={styles.ohlcRow}>
                    <span>O {formatPrice(latestCandle?.open)}</span>
                    <span>H {formatPrice(latestCandle?.high)}</span>
                    <span>L {formatPrice(latestCandle?.low)}</span>
                    <span>C {formatPrice(latestCandle?.close ?? selectedStock?.lastPrice)}</span>
                    <span className={candleChange >= 0 ? 'text-green' : 'text-red'}>
                      {candleChange >= 0 ? '+' : ''}{formatPrice(candleChange)} ({formatPercent(candlePercent)})
                    </span>
                  </div>
                </div>

                <div style={styles.chartPanel}>
                  <CandlestickChart />
                </div>
              </section>

              <section style={styles.rsiShell}>
                <div style={styles.rsiPanel}>
                  <RSIPanel />
                </div>
              </section>
            </div>
          </div>
        </main>

        <SideSignalList
          title="Selling Shares"
          emptyText="No aggressive selling clusters detected right now."
          signals={sellingSignals}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={onSelectSymbol}
          accent="var(--accent-red)"
          lookback={lookback}
          setLookback={setLookback}
        />
      </div>
    </div>
  );
}

function App() {
  const { isConnected } = useWebSocket();
  const selectedSymbol = useMarketStore((state) => state.selectedSymbol);
  const setHistory = useMarketStore((state) => state.setHistory);
  const isMarketOpen = useMarketStore((state) => state.isMarketOpen);
  const setSelectedSymbol = useMarketStore((state) => state.setSelectedSymbol);
  const theme = useMarketStore((state) => state.theme);
  const toggleTheme = useMarketStore((state) => state.toggleTheme);
  const candles = useMarketStore((state) => state.candles);
  const watchlist = useMarketStore((state) => state.watchlist);

  const [activeTimeframe, setActiveTimeframe] = useState('D');
  const [isFloorsheetOpen, setIsFloorsheetOpen] = useState(false);
  const [floorsheetData, setFloorsheetData] = useState(null);
  const [floorsheetLoading, setFloorsheetLoading] = useState(false);
  const [floorsheetError, setFloorsheetError] = useState('');
  const [topSearchQuery, setTopSearchQuery] = useState('');
  const [companyUniverse, setCompanyUniverse] = useState([]);
  const [lookback, setLookback] = useState('recent');

  const handleSelectSymbol = (symbol) => {
    if (!symbol) return;
    const normalizedSymbol = symbol.toUpperCase();
    setHistory({ candles: [], rsi: [], baseline: null });
    setSelectedSymbol(normalizedSymbol);
    setTopSearchQuery('');
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [listResponse, universeResponse, historyResponse] = await Promise.all([
          marketApi.getStockList(),
          marketApi.getSecurityUniverse(),
          marketApi.getHistory(selectedSymbol),
        ]);

        if (listResponse.success) {
          useMarketStore.getState().setWatchlist(listResponse.data);
        }

        if (universeResponse.success) {
          setCompanyUniverse(universeResponse.data);
        }

        if (historyResponse.success) {
          setHistory(historyResponse.data);
        }
      } catch (e) {
        console.error('Error fetching data', e);
      }
    };

    fetchData();
  }, [selectedSymbol, setHistory]);

  useEffect(() => {
    let cancelled = false;

    const fetchFloorsheet = async () => {
      try {
        setFloorsheetLoading(true);
        setFloorsheetError('');
        const response = await marketApi.getFloorsheetAnalysis({ lookback, pageCount: 5, pageSize: 500, tickSize: 0.1, zerosPerStrength: 10 });
        if (!cancelled) {
          setFloorsheetData(response);
        }
      } catch (error) {
        if (!cancelled) {
          setFloorsheetError(error?.response?.data?.message || error.message || 'Failed to fetch floorsheet analysis');
        }
      } finally {
        if (!cancelled) {
          setFloorsheetLoading(false);
        }
      }
    };

    fetchFloorsheet();
    const intervalId = setInterval(fetchFloorsheet, 15000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [lookback]);

  const selectedStock = useMemo(
    () => watchlist.find((item) => item.symbol === selectedSymbol) || null,
    [selectedSymbol, watchlist]
  );

  const signals = floorsheetData?.signals || [];
  const buyingSignals = signals.filter((signal) => signal.signal === 'Aggressive Buying').slice(0, 12);
  const sellingSignals = signals.filter((signal) => signal.signal === 'Aggressive Selling').slice(0, 12);

  if (isFloorsheetOpen) {
    return (
      <div style={styles.appContainer}>
        <header style={styles.topToolbar}>
          <div style={styles.topToolbarLeft}>
            <button type="button" style={styles.backButton} onClick={() => setIsFloorsheetOpen(false)}>
              Back To Chart
            </button>
            <div style={styles.symbolSearchBox}>
              <span style={styles.searchIcon}>⌕</span>
              <span style={styles.symbolSearchText}>{selectedSymbol}</span>
            </div>
          </div>

          <div style={styles.topToolbarRight}>
            <div style={styles.streamBadge(isConnected)}>
              {isConnected ? 'Stream Online' : 'Stream Offline'}
            </div>
            <div style={styles.marketBadge(isMarketOpen)}>
              {isMarketOpen ? 'Market Open' : 'Market Closed'}
            </div>
            <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </header>

        <FloorsheetDashboard
          floorsheetData={floorsheetData}
          floorsheetLoading={floorsheetLoading}
          floorsheetError={floorsheetError}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={handleSelectSymbol}
        />
      </div>
    );
  }

  return (
    <TradingDashboard
      selectedSymbol={selectedSymbol}
      selectedStock={selectedStock}
      candles={candles}
      companies={companyUniverse}
      topSearchQuery={topSearchQuery}
      setTopSearchQuery={setTopSearchQuery}
      activeTimeframe={activeTimeframe}
      setActiveTimeframe={setActiveTimeframe}
      theme={theme}
      toggleTheme={toggleTheme}
      isConnected={isConnected}
      isMarketOpen={isMarketOpen}
      buyingSignals={buyingSignals}
      sellingSignals={sellingSignals}
      onSelectSymbol={handleSelectSymbol}
      onOpenFloorsheet={() => setIsFloorsheetOpen(true)}
      lookback={lookback}
      setLookback={setLookback}
    />
  );
}

const styles = {
  appContainer: { display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: 'var(--bg-primary)', overflow: 'hidden' },
  topToolbar: { minHeight: '60px', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', gap: '16px' },
  topToolbarLeft: { display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: 1 },
  topToolbarRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  topSearchWrap: { position: 'relative', minWidth: '220px', maxWidth: '360px', width: '100%' },
  topSearchBox: { display: 'flex', alignItems: 'center', gap: '8px', height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' },
  topSearchInput: { width: '100%', border: 'none', background: 'transparent', color: 'var(--text-primary)', outline: 'none', fontWeight: 700, letterSpacing: '0.04em' },
  topSearchDropdown: { position: 'absolute', top: '44px', left: 0, right: 0, zIndex: 20, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', boxShadow: '0 14px 30px rgba(0,0,0,0.16)', overflow: 'hidden', maxHeight: '360px', overflowY: 'auto' },
  topSearchEmpty: { padding: '14px', color: 'var(--text-secondary)', fontSize: '13px' },
  topSearchOption: { width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '4px' },
  topSearchOptionSymbol: { fontWeight: 800, fontSize: '14px' },
  topSearchOptionName: { fontSize: '12px', color: 'var(--text-secondary)' },
  symbolSearchBox: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '140px', height: '38px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)' },
  searchIcon: { color: 'var(--text-secondary)', fontSize: '14px' },
  symbolSearchText: { fontWeight: 700, letterSpacing: '0.04em' },
  backButton: { height: '36px', padding: '0 14px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 700 },
  timeframeGroup: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' },
  timeframeButton: { height: '34px', minWidth: '38px', padding: '0 12px', borderRadius: '10px', border: '1px solid transparent', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 },
  timeframeButtonActive: { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' },
  actionGroup: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  actionButton: { height: '34px', padding: '0 12px', borderRadius: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 },
  streamBadge: (isConnected) => ({ padding: '8px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, border: `1px solid ${isConnected ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.35)'}`, background: isConnected ? 'var(--accent-green-bg)' : 'var(--accent-red-bg)', color: isConnected ? 'var(--accent-green)' : 'var(--accent-red)' }),
  marketBadge: (isOpen) => ({ padding: '8px 10px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, border: `1px solid ${isOpen ? 'rgba(38, 166, 154, 0.4)' : 'rgba(245, 158, 11, 0.4)'}`, background: isOpen ? 'var(--accent-green-bg)' : 'rgba(245, 158, 11, 0.16)', color: isOpen ? 'var(--accent-green)' : '#f59e0b' }),
  mainAreaNoStrip: { display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr) 300px', flex: 1, overflow: 'hidden', minHeight: 0 },
  sidePanel: { background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, overflow: 'hidden' },
  sidePanelHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 16px 14px', borderBottom: '1px solid var(--border-color)', gap: '10px' },
  sidePanelTitle: { fontSize: '18px', fontWeight: 700 },
  sidePanelSubtitle: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' },
  sidePanelFilterButton: { height: '36px', padding: '0 12px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 700 },
  sidePanelFilterWrap: { position: 'relative' },
  sidePanelFilterDropdown: { position: 'absolute', top: '44px', right: 0, zIndex: 10, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 14px 30px rgba(0,0,0,0.16)', minWidth: '160px' },
  sidePanelFilterOption: { width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 700 },
  sidePanelBody: { flex: 1, overflowY: 'auto', padding: '12px', minHeight: 0 },
  signalListCard: { width: '100%', textAlign: 'left', padding: '12px', marginBottom: '10px', borderRadius: '14px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-primary)', cursor: 'pointer' },
  signalListCardActive: { background: 'var(--bg-tertiary)' },
  signalListTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
  signalListSymbol: { fontSize: '17px', fontWeight: 800 },
  signalListName: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' },
  signalPill: { padding: '4px 8px', borderRadius: '999px', border: '1px solid currentColor', fontSize: '11px', fontWeight: 700, whiteSpace: 'nowrap' },
  signalListStats: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '10px', color: 'var(--text-secondary)', fontSize: '12px' },
  signalListMuted: { color: 'var(--text-secondary)', fontSize: '12px' },
  workspace: { flex: 1, display: 'flex', minWidth: 0, minHeight: 0, background: 'var(--bg-primary)', borderLeft: '1px solid var(--border-color)', borderRight: '1px solid var(--border-color)', padding: '10px' },
  chartStackShell: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', border: '1px solid var(--border-color)', borderRadius: '18px', background: 'var(--bg-secondary)', overflow: 'hidden' },
  leftToolRail: { width: '62px', borderRight: '1px solid var(--border-color)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '14px 8px' },
  toolButton: { width: '42px', height: '42px', borderRadius: '12px', border: '1px solid var(--border-color)', background: 'var(--bg-primary)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '12px', fontWeight: 700 },
  chartWorkspace: { flex: 1, minWidth: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr) 240px', gap: '0px', padding: '0px' },
  chartShell: { display: 'flex', flexDirection: 'column', minHeight: 0, borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)', overflow: 'hidden' },
  chartHeader: { padding: '16px 18px 12px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start' },
  chartTitleBlock: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 },
  chartTitleLine: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  chartSymbol: { fontSize: '28px', fontWeight: 800, letterSpacing: '0.02em' },
  chartName: { fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' },
  chartTimeframe: { color: 'var(--text-secondary)', fontWeight: 700 },
  chartSubMeta: { display: 'flex', gap: '14px', color: 'var(--text-secondary)', fontSize: '13px', flexWrap: 'wrap' },
  ohlcRow: { display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', fontWeight: 700, fontSize: '14px' },
  chartPanel: { flex: 1, minHeight: 0, background: 'var(--bg-primary)' },
  rsiShell: { display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-secondary)', overflow: 'hidden' },
  panelLabelRow: { display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--border-color)' },
  panelTitle: { fontSize: '15px', fontWeight: 700 },
  panelHint: { fontSize: '12px', color: 'var(--text-secondary)' },
  rsiPanel: { flex: 1, minHeight: 0, background: 'var(--bg-primary)' },
  floorsheetDashboard: { flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' },
  floorsheetHero: { display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start', padding: '18px', border: '1px solid var(--border-color)', borderRadius: '18px', background: 'var(--bg-secondary)' },
  floorsheetTitle: { fontSize: '28px', fontWeight: 800 },
  floorsheetSubtitle: { marginTop: '6px', color: 'var(--text-secondary)', fontSize: '14px' },
  floorsheetMeta: { display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--text-secondary)', fontSize: '13px', textAlign: 'right' },
  floorsheetSummaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' },
  floorsheetSummaryCard: { padding: '14px 16px', border: '1px solid var(--border-color)', borderRadius: '16px', background: 'var(--bg-secondary)' },
  floorsheetSummaryLabel: { color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' },
  floorsheetSummaryValue: { marginTop: '6px', fontSize: '24px', fontWeight: 800 },
  floorsheetMainGrid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: '12px' },
  floorsheetPanelLarge: { display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border-color)', borderRadius: '18px', background: 'var(--bg-secondary)', overflow: 'hidden' },
  floorsheetPanelSide: { display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border-color)', borderRadius: '18px', background: 'var(--bg-secondary)', overflow: 'hidden' },
  floorsheetPanelFull: { display: 'flex', flexDirection: 'column', minHeight: 0, border: '1px solid var(--border-color)', borderRadius: '18px', background: 'var(--bg-secondary)', overflow: 'hidden' },
  tableWrap: { overflow: 'auto', maxHeight: '420px' },
  tableWrapTall: { overflow: 'auto', maxHeight: '460px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { position: 'sticky', top: 0, background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left', padding: '12px', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' },
  td: { padding: '12px', borderBottom: '1px solid var(--border-color)', fontSize: '13px', whiteSpace: 'nowrap' },
  trClickable: { cursor: 'pointer' },
  emptyState: { height: '100%', minHeight: '160px', display: 'grid', placeItems: 'center', color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' },
};

export default App;
