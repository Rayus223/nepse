export function calculateRSI(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length === 0) return [];
    if (closes.length <= period) return closes.map(() => null);

    const rsi = new Array(closes.length).fill(null);
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 1; i <= period; i++) {
        const change = closes[i] - closes[i - 1];
        if (change > 0) {
            avgGain += change;
        } else {
            avgLoss += Math.abs(change);
        }
    }

    avgGain /= period;
    avgLoss /= period;

    rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));

    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;

        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;

        rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + (avgGain / avgLoss)));
    }

    return rsi;
}

export function buildRsiSeries(candles, period = 14) {
    if (!Array.isArray(candles) || candles.length === 0) return [];

    const closes = candles.map((candle) => candle.close);
    const rsiValues = calculateRSI(closes, period);

    return rsiValues.map((value, index) => (
        value === null
            ? { time: candles[index].time }
            : { time: candles[index].time, value }
    ));
}

export function buildRsiBaselines(candles, period = 14) {
    if (!Array.isArray(candles) || candles.length === 0) return [];

    const closes = candles.map((candle) => candle.close);
    const rsiValues = calculateRSI(closes, period);
    let latestBaseline = null;

    for (let i = 1; i < rsiValues.length; i++) {
        const previousRsi = rsiValues[i - 1];
        const currentRsi = rsiValues[i];

        if (previousRsi === null || currentRsi === null) continue;
        if (!(previousRsi < 70 && currentRsi >= 70)) continue;

        for (let j = i - 1; j >= 0; j--) {
            const priorRsi = rsiValues[j];
            if (priorRsi !== null && priorRsi < 50) {
                latestBaseline = {
                    id: `${candles[i].time}-${candles[j].time}`,
                    price: candles[j].close,
                    triggerTime: candles[i].time,
                    sourceTime: candles[j].time,
                };
                break;
            }
        }
    }

    return latestBaseline ? [latestBaseline] : [];
}
