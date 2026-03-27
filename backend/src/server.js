import express from 'express';
import cors from 'cors';
import http from 'http';
import { setupWebSocketServer } from './websocket/wsServer.js';
import marketRoutes from './routes/market.js';
import stockRoutes from './routes/stocks.js';
import floorsheetRoutes from './routes/floorsheet.js';
import { startNepsePolling } from './services/nepseService.js';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/market', marketRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/floorsheet', floorsheetRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Setup WebSocket
setupWebSocketServer(server);

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // Start background polling service
    startNepsePolling();
});
