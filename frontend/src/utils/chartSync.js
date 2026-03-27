const charts = new Map();
let activeSourceId = null;

// Crosshair sync across multiple charts so the vertical cursor line stays aligned.
// lightweight-charts v5 supports chart.setCrosshairPosition / clearCrosshairPosition.
const crosshairTargets = new Map();
let activeCrosshairSourceId = null;

export function registerSyncedChart(id, chart) {
    charts.set(id, chart);

    return () => {
        charts.delete(id);
        if (activeSourceId === id) {
            activeSourceId = null;
        }
    };
}

export function registerCrosshairTarget(id, target) {
    crosshairTargets.set(id, target);

    return () => {
        crosshairTargets.delete(id);
        if (activeCrosshairSourceId === id) {
            activeCrosshairSourceId = null;
        }
    };
}

export function syncVisibleLogicalRange(sourceId, range) {
    if (!range) return;

    activeSourceId = sourceId;

    for (const [id, chart] of charts.entries()) {
        if (id === sourceId) continue;
        chart.timeScale().setVisibleLogicalRange(range);
    }

    activeSourceId = null;
}

export function isSyncSource(id) {
    return activeSourceId === id;
}

export function isCrosshairSyncSource(id) {
    return activeCrosshairSourceId === id;
}

export function isCrosshairSyncInProgress() {
    return activeCrosshairSourceId !== null;
}

export function syncCrosshairTime(sourceId, time) {
    if (time === undefined || time === null) return;

    activeCrosshairSourceId = sourceId;

    for (const [id, target] of crosshairTargets.entries()) {
        if (id === sourceId) continue;
        const { chart, series, getPriceAtTime, fallbackPrice } = target || {};
        if (!chart || !series) continue;

        const price = typeof getPriceAtTime === 'function' ? getPriceAtTime(time) : undefined;
        const resolvedPrice = (typeof price === 'number' && Number.isFinite(price))
            ? price
            : (typeof fallbackPrice === 'number' && Number.isFinite(fallbackPrice) ? fallbackPrice : 0);

        chart.setCrosshairPosition(resolvedPrice, time, series);
    }

    activeCrosshairSourceId = null;
}

export function clearSyncedCrosshair(sourceId) {
    activeCrosshairSourceId = sourceId;

    for (const [id, target] of crosshairTargets.entries()) {
        if (id === sourceId) continue;
        const { chart } = target || {};
        if (!chart) continue;
        chart.clearCrosshairPosition();
    }

    activeCrosshairSourceId = null;
}
