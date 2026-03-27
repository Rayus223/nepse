import express from 'express';
import { ensureMarketDataReady, getMarketSummary } from '../services/nepseService.js';

const router = express.Router();

router.get('/summary', async (req, res) => {
    try {
        await ensureMarketDataReady();
        const summary = getMarketSummary();
        if (summary) {
            res.json({ success: true, data: summary });
            return;
        }

        res.status(503).json({
            success: false,
            message: 'Market summary not available yet'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch market summary'
        });
    }
});

export default router;
