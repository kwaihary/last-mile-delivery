import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://last-mile-delivery-l7y0.onrender.com/api' : 'http://localhost:5000/api');

const api = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json'
    }
});

// Tự động gắn Token trước khi gửi request
api.interceptors.request.use((config) => {
    // Lấy token từ LocalStorage sau khi đăng nhập thành công
    const token = localStorage.getItem('accessToken');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

// Xử lý lỗi tập trung
api.interceptors.response.use((response) => {
    return response;
}, (error) => {
    if (error.response && error.response.status === 401) {
        console.error("Token hết hạn hoặc không hợp lệ!");
        // xóa token và đẩy về trang Login
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        window.location.href = '/login';
    }
    return Promise.reject(error);
});

export default api;