import express from 'express';
import { ensureMarketDataReady, getSecurityUniverse, getStockHistory, getStockState, getAllStocksState } from '../services/nepseService.js';
import { calculateRSI, getBaselineTrigger } from '../indicators/rsiEngine.js';

const router = express.Router();

router.get('/list', async (req, res) => {
    try {
        await ensureMarketDataReady();
        const states = getAllStocksState();
        const list = Object.values(states).map(s => ({
            symbol: s.symbol,
            securityName: s.securityName,
            lastPrice: s.lastPrice,
            change: s.change,
            percentChange: s.percentChange
        })).sort((a, b) => a.symbol.localeCompare(b.symbol));
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Failed to fetch stock list' });
    }
});

router.get('/universe', async (req, res) => {
    try {
        const universe = await getSecurityUniverse();
        res.json({ success: true, data: universe });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Failed to fetch security universe' });
    }
});

router.get('/:symbol/history', async (req, res) => {
    const { symbol } = req.params;
    try {
        const history = await getStockHistory(symbol.toUpperCase());

        if (history && history.length > 0) {
            const closes = history.map(c => c.close);
            const rsi = calculateRSI(closes);
            const baseline = getBaselineTrigger(rsi, history);

            res.json({
                success: true,
                data: {
                    candles: history,
                    rsi: rsi
                        .map((val, i) => val === null ? null : ({ time: history[i].time, value: val }))
                        .filter(Boolean),
                    baseline
                }
            });
            return;
        }

        res.status(404).json({ success: false, message: 'Stock history not found' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Failed to fetch stock history' });
    }
});

router.get('/:symbol/live', (req, res) => {
    const { symbol } = req.params;
    const state = getStockState(symbol.toUpperCase());
    if (state) {
        res.json({
            success: true,
            data: {
                price: state.lastPrice,
                change: state.change,
                percentChange: state.percentChange
            }
        });
    } else {
         res.status(404).json({ success: false, message: 'Stock not tracking live' });
    }
});

export default router;
