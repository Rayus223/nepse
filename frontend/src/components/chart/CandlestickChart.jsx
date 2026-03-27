import React, { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { useMarketStore } from '../../store/marketStore';
import {
    clearSyncedCrosshair,
    isCrosshairSyncInProgress,
    isCrosshairSyncSource,
    isSyncSource,
    registerCrosshairTarget,
    registerSyncedChart,
    syncCrosshairTime,
    syncVisibleLogicalRange,
} from '../../utils/chartSync';

const CHART_THEMES = {
    dark: {
        background: '#0d1117',
        textColor: '#8b949e',
        gridColor: 'rgba(48, 54, 61, 0.5)',
        borderColor: '#30363d',
        upColor: '#26a69a',
        downColor: '#ef5350',
        volUp: 'rgba(38, 166, 154, 0.5)',
        volDown: 'rgba(239, 83, 80, 0.5)',
    },
    light: {
        background: '#f5f7fa',
        textColor: '#5a5a7a',
        gridColor: 'rgba(209, 213, 219, 0.5)',
        borderColor: '#d1d5db',
        upColor: '#16a085',
        downColor: '#e74c3c',
        volUp: 'rgba(22, 160, 133, 0.5)',
        volDown: 'rgba(231, 76, 60, 0.5)',
    },
};

export default function CandlestickChart() {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);
    const candleSeriesRef = useRef(null);
    const volumeSeriesRef = useRef(null);
    const baselineLinesRef = useRef([]);
    const chartIdRef = useRef(`candles-${Math.random().toString(36).slice(2)}`);
    const previousCandleCountRef = useRef(0);
    const closeByTimeRef = useRef(new Map());
    const lastCloseRef = useRef(0);

    const candles = useMarketStore(state => state.candles);
    const baselinePrices = useMarketStore(state => state.baselinePrices);
    const theme = useMarketStore(state => state.theme);

    // Chart init
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const t = CHART_THEMES.dark;
        const chart = createChart(chartContainerRef.current, {
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            layout: {
                background: { type: 'solid', color: t.background },
                textColor: t.textColor,
            },
            grid: {
                vertLines: { color: t.gridColor },
                horzLines: { color: t.gridColor },
            },
            crosshair: { mode: 0 },
            timeScale: {
                visible: false, // show dates only under RSI (single bottom axis)
                timeVisible: true,
                secondsVisible: false,
                borderColor: t.borderColor,
            },
            rightPriceScale: { borderColor: t.borderColor },
        });

        // v5 API: addSeries(SeriesType, options)
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: t.upColor,
            downColor: t.downColor,
            borderDownColor: t.downColor,
            borderUpColor: t.upColor,
            wickDownColor: t.downColor,
            wickUpColor: t.upColor,
        });

        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: t.upColor,
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume_scale',
        });

        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.85, bottom: 0 },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;
        const unregisterChart = registerSyncedChart(chartIdRef.current, chart);
        const unregisterCrosshair = registerCrosshairTarget(chartIdRef.current, {
            chart,
            series: candleSeries,
            getPriceAtTime: (time) => closeByTimeRef.current.get(time) ?? lastCloseRef.current ?? 0,
            fallbackPrice: lastCloseRef.current ?? 0,
        });

        chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (range && !isSyncSource(chartIdRef.current)) {
                syncVisibleLogicalRange(chartIdRef.current, range);
            }
        });

        const handleCrosshairMove = (param) => {
            // Ignore programmatic sync events from another chart.
            if (isCrosshairSyncInProgress() && !isCrosshairSyncSource(chartIdRef.current)) return;

            if (!param || param.time === undefined || param.time === null) {
                clearSyncedCrosshair(chartIdRef.current);
                return;
            }

            syncCrosshairTime(chartIdRef.current, param.time);
        };

        chart.subscribeCrosshairMove(handleCrosshairMove);

        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight,
                });
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
            chart.remove();
            chartRef.current = null;
            candleSeriesRef.current = null;
            volumeSeriesRef.current = null;
            baselineLinesRef.current = [];
            unregisterCrosshair();
            unregisterChart();
        };
    }, []);

    // Theme reactivity
    useEffect(() => {
        if (!chartRef.current || !candleSeriesRef.current) return;
        const t = CHART_THEMES[theme] || CHART_THEMES.dark;

        chartRef.current.applyOptions({
            layout: {
                background: { type: 'solid', color: t.background },
                textColor: t.textColor,
            },
            grid: {
                vertLines: { color: t.gridColor },
                horzLines: { color: t.gridColor },
            },
            timeScale: { borderColor: t.borderColor },
            rightPriceScale: { borderColor: t.borderColor },
        });

        candleSeriesRef.current.applyOptions({
            upColor: t.upColor,
            downColor: t.downColor,
            borderDownColor: t.downColor,
            borderUpColor: t.upColor,
            wickDownColor: t.downColor,
            wickUpColor: t.upColor,
        });
    }, [theme]);

    // Data update
    useEffect(() => {
        if (!candleSeriesRef.current || !volumeSeriesRef.current || !candles || candles.length === 0) return;

        const t = CHART_THEMES[theme] || CHART_THEMES.dark;
        const seen = new Set();
        const chartData = [];
        const volData = [];

        candles.forEach(c => {
            if (!seen.has(c.time)) {
                seen.add(c.time);
                chartData.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
                volData.push({
                    time: c.time,
                    value: c.volume,
                    color: c.close >= c.open ? t.volUp : t.volDown,
                });
            }
        });

        // Sort ascending by time (lightweight-charts requirement)
        chartData.sort((a, b) => a.time - b.time);
        volData.sort((a, b) => a.time - b.time);

        candleSeriesRef.current.setData(chartData);
        volumeSeriesRef.current.setData(volData);

        closeByTimeRef.current = new Map(chartData.map((c) => [c.time, c.close]));
        if (chartData.length > 0) {
            lastCloseRef.current = chartData[chartData.length - 1].close;
        }

        if (previousCandleCountRef.current === 0 && chartData.length > 0) {
            chartRef.current?.timeScale().fitContent();
        }
        previousCandleCountRef.current = chartData.length;
    }, [candles, theme]);

    // RSI baseline price lines
    useEffect(() => {
        if (!candleSeriesRef.current) return;

        baselineLinesRef.current.forEach((line) => {
            candleSeriesRef.current.removePriceLine(line);
        });
        baselineLinesRef.current = [];

        if (!Array.isArray(baselinePrices) || baselinePrices.length === 0) {
            return;
        }

        baselineLinesRef.current = baselinePrices
            .filter((baseline) => typeof baseline?.price === 'number')
            .map((baseline, index) => candleSeriesRef.current.createPriceLine({
                price: baseline.price,
                color: theme === 'dark' ? '#58a6ff' : '#3b82f6',
                lineWidth: 2,
                lineStyle: 0, // Solid
                axisLabelVisible: true,
                title: 'RSI Baseline',
            }));
    }, [baselinePrices, theme]);

    return <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />;
}
