import { create } from 'zustand';
import { buildRsiBaselines, buildRsiSeries } from '../utils/rsi';

export const useMarketStore = create((set, get) => ({
    marketSummary: null,
    isMarketOpen: false,
    setMarketSummary: (summary) => set({ marketSummary: summary }),

    // Theme
    theme: 'dark',
    toggleTheme: () => set((state) => {
        const newTheme = state.theme === 'dark' ? 'light' : 'dark';
        if (newTheme === 'light') {
            document.documentElement.setAttribute('data-theme', 'light');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        return { theme: newTheme };
    }),
    
    selectedSymbol: 'NABIL',
    setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),

    watchlist: [],
    setWatchlist: (list) => set({ watchlist: list }),
    updateWatchlistTick: (tickData) => set((state) => ({
        watchlist: state.watchlist.map(item => 
            item.symbol === tickData.symbol 
                ? { ...item, lastPrice: tickData.price, change: tickData.change, percentChange: tickData.percentChange }
                : item
        )
    })),

    // Active chart data
    candles: [],
    rsi: [],
    baselinePrices: [],

    setHistory: (data) => set(() => {
        const candles = data.candles || [];
        return {
            candles,
            rsi: buildRsiSeries(candles),
            baselinePrices: buildRsiBaselines(candles)
        };
    }),

    addCandleTock: (candle, symbol) => {
        const state = get();
        if (state.selectedSymbol !== symbol) return;

        set((prevState) => {
             const newCandles = [...prevState.candles];
             const lastCandle = newCandles[newCandles.length - 1];

             if (!lastCandle) {
                 const candles = [candle];
                 return {
                     candles,
                     rsi: buildRsiSeries(candles),
                     baselinePrices: buildRsiBaselines(candles)
                 };
             }

             if (candle.time === lastCandle.time) {
                 // Update ongoing candle
                 newCandles[newCandles.length - 1] = candle;
             } else {
                 // Add new candle
                 newCandles.push(candle);
             }

             return {
                 candles: newCandles,
                 rsi: buildRsiSeries(newCandles),
                 baselinePrices: buildRsiBaselines(newCandles)
             };
        });
    },

    setMarketStatus: (status) => set({ isMarketOpen: status.isOpen }),
}));
