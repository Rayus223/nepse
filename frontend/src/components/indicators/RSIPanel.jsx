import React, { useEffect, useRef } from 'react';
import { createChart, BaselineSeries, LineSeries } from 'lightweight-charts';
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

const RSI_THEMES = {
    dark: {
        background: '#0d1117',
        textColor: '#8b949e',
        gridColor: 'rgba(48, 54, 61, 0.5)',
        borderColor: '#30363d',
        lineColor: '#b2b5be',
        overbought: 'rgba(239, 83, 80, 0.5)',
        oversold: 'rgba(38, 166, 154, 0.5)',
        midline: 'rgba(139, 148, 158, 0.3)',
    },
    light: {
        background: '#f5f7fa',
        textColor: '#5a5a7a',
        gridColor: 'rgba(209, 213, 219, 0.5)',
        borderColor: '#d1d5db',
        lineColor: '#3a3a5a',
        overbought: 'rgba(231, 76, 60, 0.5)',
        oversold: 'rgba(22, 160, 133, 0.5)',
        midline: 'rgba(90, 90, 122, 0.3)',
    },
};

export default function RSIPanel() {
    const chartContainerRef = useRef(null);
    const chartRef = useRef(null);
    const bandSeriesRef = useRef(null);
    const rsiSeriesRef = useRef(null);
    const chartIdRef = useRef(`rsi-${Math.random().toString(36).slice(2)}`);
    const previousRsiCountRef = useRef(0);
    const rsiByTimeRef = useRef(new Map());
    const lastRsiRef = useRef(50);

    const rsiData = useMarketStore(state => state.rsi);
    const theme = useMarketStore(state => state.theme);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        const t = RSI_THEMES.dark;
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
                visible: true, // show the single shared date axis under RSI
                timeVisible: true,
                secondsVisible: false,
                borderColor: t.borderColor,
            },
            rightPriceScale: { borderColor: t.borderColor },
        });

        // v5 API: addSeries(LineSeries, options)
        const bandSeries = chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price', price: 30 },
            topLineColor: 'rgba(0, 0, 0, 0)',
            bottomLineColor: 'rgba(0, 0, 0, 0)',
            topFillColor1: theme === 'dark' ? 'rgba(167, 139, 250, 0.14)' : 'rgba(167, 139, 250, 0.18)',
            topFillColor2: theme === 'dark' ? 'rgba(167, 139, 250, 0.08)' : 'rgba(167, 139, 250, 0.12)',
            bottomFillColor1: 'rgba(0, 0, 0, 0)',
            bottomFillColor2: 'rgba(0, 0, 0, 0)',
            lineWidth: 1,
        });

        const rsiSeries = chart.addSeries(LineSeries, {
            color: t.lineColor,
            lineWidth: 2,
            // Remove the "last value" horizontal line (the dotted line around ~67.xx)
            // and remove the moving marker dot on crosshair.
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
        });

        // Reference lines at 70, 50, and 30
        rsiSeries.createPriceLine({
            price: 70,
            color: t.overbought,
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: '70',
        });

        rsiSeries.createPriceLine({
            price: 30,
            color: t.oversold,
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: '30',
        });

        rsiSeries.createPriceLine({
            price: 50,
            color: t.midline,
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: false,
        });

        chartRef.current = chart;
        bandSeriesRef.current = bandSeries;
        rsiSeriesRef.current = rsiSeries;
        const unregisterChart = registerSyncedChart(chartIdRef.current, chart);
        const unregisterCrosshair = registerCrosshairTarget(chartIdRef.current, {
            chart,
            series: rsiSeries,
            getPriceAtTime: (time) => rsiByTimeRef.current.get(time) ?? lastRsiRef.current ?? 50,
            fallbackPrice: lastRsiRef.current ?? 50,
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
            bandSeriesRef.current = null;
            rsiSeriesRef.current = null;
            unregisterCrosshair();
            unregisterChart();
        };
    }, []);

    // Theme reactivity
    useEffect(() => {
        if (!chartRef.current || !rsiSeriesRef.current || !bandSeriesRef.current) return;
        const t = RSI_THEMES[theme] || RSI_THEMES.dark;

        chartRef.current.applyOptions({
            layout: {
                background: { type: 'solid', color: t.background },
                textColor: t.textColor,
            },
            grid: {
                vertLines: { color: t.gridColor },
                horzLines: { color: t.gridColor },
            },
            timeScale: { borderColor: t.borderColor, visible: true },
            rightPriceScale: { borderColor: t.borderColor },
        });

        rsiSeriesRef.current.applyOptions({
            color: t.lineColor,
        });

        bandSeriesRef.current.applyOptions({
            topFillColor1: theme === 'dark' ? 'rgba(167, 139, 250, 0.14)' : 'rgba(167, 139, 250, 0.18)',
            topFillColor2: theme === 'dark' ? 'rgba(167, 139, 250, 0.08)' : 'rgba(167, 139, 250, 0.12)',
        });
    }, [theme]);

    // Update RSI data
    useEffect(() => {
        if (!rsiSeriesRef.current || !bandSeriesRef.current || !rsiData || rsiData.length === 0) return;

        const seen = new Set();
        const chartData = [];
        const bandData = [];

        rsiData.forEach(d => {
            if (!seen.has(d.time)) {
                seen.add(d.time);
                chartData.push(d.value === undefined ? { time: d.time } : { time: d.time, value: d.value });
                bandData.push({ time: d.time, value: 70 });
            }
        });

        chartData.sort((a, b) => a.time - b.time);
        bandData.sort((a, b) => a.time - b.time);

        if (chartData.length > 0) {
            bandSeriesRef.current.setData(bandData);
            rsiSeriesRef.current.setData(chartData);

            const nextMap = new Map();
            let last = lastRsiRef.current ?? 50;
            chartData.forEach((point) => {
                if (typeof point.value === 'number' && Number.isFinite(point.value)) {
                    last = point.value;
                }
                nextMap.set(point.time, last);
            });
            rsiByTimeRef.current = nextMap;
            lastRsiRef.current = last;

            if (previousRsiCountRef.current === 0) {
                chartRef.current?.timeScale().fitContent();
            }
            previousRsiCountRef.current = chartData.length;
        }
    }, [rsiData]);

    return <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />;
}
