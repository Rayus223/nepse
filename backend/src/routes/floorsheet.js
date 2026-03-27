import express from 'express';
import { getLiveFloorsheetAnalysis } from '../services/floorsheetService.js';

const router = express.Router();

router.get('/analysis', async (req, res) => {
    try {
        const pageSize = req.query.pageSize;
        const pageCount = req.query.pageCount;
        const lookback = req.query.lookback;
        const tickSize = req.query.tickSize;
        const zerosPerStrength = req.query.zerosPerStrength;
        const result = await getLiveFloorsheetAnalysis({ pageSize, pageCount, lookback, tickSize, zerosPerStrength });
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to analyze floorsheet data'
        });
    }
});

export default router;
