import axios from 'axios';

const api = axios.create({
    baseURL: 'http://localhost:4000/api',
});

export const marketApi = {
    getSummary: async () => {
        const res = await api.get('/market/summary');
        return res.data;
    },
    getStockList: async () => {
        const res = await api.get('/stocks/list');
        return res.data;
    },
    getSecurityUniverse: async () => {
        const res = await api.get('/stocks/universe');
        return res.data;
    },
    getHistory: async (symbol) => {
        const res = await api.get(`/stocks/${symbol}/history`);
        return res.data;
    },
    getFloorsheetAnalysis: async (params = {}) => {
        const res = await api.get('/floorsheet/analysis', { params });
        return res.data;
    }
};
