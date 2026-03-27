/**
 * Calculates Wilder's Smoothed RSI.
 * @param {number[]} closes Array of closing prices
 * @param {number} period RSI period (default 14)
 * @returns {number[]} Array of RSI values matching the input length (padded with nulls or calculated where possible).
 */
export function calculateRSI(closes, period = 14) {
    if (closes.length < period) return new Array(closes.length).fill(null);

    const rsi = new Array(closes.length).fill(null);
    let avgGain = 0;
    let avgLoss = 0;

    // Initial SMA for the first period
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

    if (avgLoss === 0) {
        rsi[period] = 100;
    } else {
        const rs = avgGain / avgLoss;
        rsi[period] = 100 - (100 / (1 + rs));
    }

    // Wilder's Smoothing for the rest
    for (let i = period + 1; i < closes.length; i++) {
        const change = closes[i] - closes[i - 1];
        let gain = 0;
        let loss = 0;

        if (change > 0) {
            gain = change;
        } else {
            loss = Math.abs(change);
        }

        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;

        if (avgLoss === 0) {
             rsi[i] = 100;
        } else {
            const rs = avgGain / avgLoss;
            rsi[i] = 100 - (100 / (1 + rs));
        }
    }

    return rsi;
}

/**
 * Custom logic: When RSI crosses above 70, scan backwards specifically finding the nearest preceding time it was < 50.
 * Returns the LOW price of that candle as the baseline level.
 * @param {number[]} rsiArray Array of RSI values
 * @param {Object[]} candles Array of candle objects with { open, high, low, close, time }
 */
export function getBaselineTrigger(rsiArray, candles) {
    if (!rsiArray || !candles || rsiArray.length !== candles.length) return null;
    if (rsiArray.length < 2) return null;

    let baselinePrice = null;

    // Check if the current (or very recent) RSI is > 70
    const latestRsiIndex = rsiArray.length - 1;
    const latestRsi = rsiArray[latestRsiIndex];

    if (latestRsi > 70) {
        // Scan backwards to find where it was last < 50
        for (let i = latestRsiIndex - 1; i >= 0; i--) {
            const val = rsiArray[i];
            if (val !== null && val < 50) {
                // Use the LOW price of that candle (the loss candle's wick low)
                baselinePrice = candles[i].low;
                break;
            }
        }
    } else {
         // Find the MOST RECENT time it crossed 70, and then find the corresponding < 50 point before that.
         for(let i = rsiArray.length - 1; i >= 0; i--) {
              if (rsiArray[i] > 70) {
                  // Found the latest overbought peak. Now find the < 50 before this peak.
                  for (let j = i - 1; j >= 0; j--) {
                      if (rsiArray[j] !== null && rsiArray[j] < 50) {
                           // Use the LOW price of that candle
                           baselinePrice = candles[j].low;
                           break;
                      }
                  }
                  break; // Stop after finding the most recent peak
              }
         }
    }

    return baselinePrice;
}
