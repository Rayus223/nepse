import { WebSocketServer, WebSocket } from 'ws';

let wss = null;

export const setupWebSocketServer = (server) => {
    wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        console.log('Client connected to WebSocket');
        
        ws.send(JSON.stringify({
            type: 'CONNECTION_ACK',
            message: 'Connected to NEPSE Market Data Stream'
        }));

        ws.on('close', () => {
            console.log('Client disconnected');
        });
        
        ws.on('error', (err) => {
             console.error('WebSocket Error:', err);
        });
    });

    console.log('WebSocket server initialized');
};

const broadcast = (message) => {
    if (!wss) return;
    const payload = JSON.stringify(message);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
};

export const broadcastMarketStatus = (data) => {
    broadcast({ type: 'MARKET_STATUS', data });
};

export const broadcastTickUpdate = (data) => {
    broadcast({ type: 'TICK', data });
};

export const broadcastRsiUpdate = (data) => {
     broadcast({ type: 'RSI_UPDATE', data });
};

export const broadcastBaselineUpdate = (data) => {
    broadcast({ type: 'BASELINE', data });
};
