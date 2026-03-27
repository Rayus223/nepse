import { useEffect, useRef, useState } from 'react';
import { useMarketStore } from '../store/marketStore';

const WS_URL = 'ws://localhost:4000';

export function useWebSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const wsRef = useRef(null);
    const reconnectTimeout = useRef(null);
    
    const { updateWatchlistTick, addCandleTock, setMarketStatus } = useMarketStore();

    useEffect(() => {
        let isMounted = true;

        const connect = () => {
            console.log("Connecting to WebSocket...");
            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                console.log("WebSocket connected");
                if (isMounted) setIsConnected(true);
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    
                    switch (message.type) {
                        case 'TICK':
                            updateWatchlistTick(message.data);
                            addCandleTock(message.data.candle, message.data.symbol);
                            break;
                        case 'MARKET_STATUS':
                            setMarketStatus(message.data);
                            break;
                        // Handle RSI and Baseline updates later if they are streamed independently
                        // For now we get them on the /history endpoint
                        default:
                            break;
                    }
                } catch (e) {
                    console.error("WS parse error", e);
                }
            };

            ws.onclose = () => {
                 console.log("WebSocket disconnected. Reconnecting in 5s...");
                 if (isMounted) setIsConnected(false);
                 reconnectTimeout.current = setTimeout(connect, 5000);
            };

            ws.onerror = (err) => {
                 console.error("WebSocket error", err);
                 ws.close();
            };

            wsRef.current = ws;
        };

        connect();

        return () => {
            isMounted = false;
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            if (wsRef.current) wsRef.current.close();
        };
    }, [updateWatchlistTick, addCandleTock, setMarketStatus]);

    return { isConnected };
}
