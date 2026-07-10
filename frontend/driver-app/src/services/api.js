/**
 * API SERVICE
 * Service giao tiếp với Backend REST API
 * Sử dụng fetch API thuần (thay vì axios để giảm bundle size)
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://last-mile-delivery-l7y0.onrender.com/api' : '/api');
const REQUEST_TIMEOUT = 15000;

// =============================================================================
// HTTP CLIENT
// =============================================================================
class ApiClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  /**
   * Tạo request với error handling
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    
    // Get auth token
    const token = localStorage.getItem('token');
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    // Add auth header
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    
    // Create abort controller for timeout
    const controller = new AbortController();
    config.signal = AbortSignal.timeout(REQUEST_TIMEOUT);
    
    try {
      const response = await fetch(url, config);
      
      // Handle 401 Unauthorized - KHÔNG reload, chỉ throw error
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('driverUser');
        // Không reload trang - chỉ throw error để UI xử lý
        throw new ApiError('Phiên đăng nhập hết hạn', 401);
      }
      
      // Parse JSON response
      const contentType = response.headers.get('content-type');
      let data;
      
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }
      
      if (!response.ok) {
        const message = data?.message || data?.error || `HTTP ${response.status}`;
        throw new ApiError(message, response.status, data);
      }
      
      return { data, status: response.status };
      
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new ApiError('Yêu cầu bị timeout', 408);
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(error.message || 'Lỗi mạng', 0);
    }
  }

  /**
   * GET request
   */
  async get(endpoint, params = {}) {
    let url = endpoint;
    
    if (Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params);
      url += `?${searchParams.toString()}`;
    }
    
    return this.request(url, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post(endpoint, body) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  /**
   * PUT request
   */
  async put(endpoint, body) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  /**
   * PATCH request
   */
  async patch(endpoint, body) {
    return this.request(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });
  }

  /**
   * DELETE request
   */
  async delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }

  /**
   * POST with FormData (for file uploads)
   */
  async postForm(endpoint, formData) {
    const token = localStorage.getItem('token');
    
    const config = {
      method: 'POST',
      body: formData
    };
    
    if (token) {
      config.headers = {
        'Authorization': `Bearer ${token}`
      };
    }
    
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, config);
      
      if (response.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('driverUser');
        throw new ApiError('Phiên đăng nhập hết hạn', 401);
      }
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new ApiError(data?.message || 'Upload failed', response.status, data);
      }
      
      return { data, status: response.status };
      
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.message || 'Upload failed', 0);
    }
  }
}

/**
 * Custom API Error
 */
class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// =============================================================================
// API INSTANCE
// =============================================================================
const api = new ApiClient(API_BASE_URL);

// =============================================================================
// AUTH API
// =============================================================================
export const authApi = {
  /**
   * Đăng nhập
   */
  login: (email, password) => {
    return api.post('/users/login', { email, password });
  },
  
  /**
   * Đăng ký
   */
  register: (userData) => {
    return api.post('/users/register', userData);
  },
  
  /**
   * Lấy thông tin user hiện tại
   */
  me: () => {
    return api.get('/users/me');
  },
  
  /**
   * Refresh token
   */
  refreshToken: (refreshToken) => {
    return api.post('/users/refresh', { refreshToken });
  }
};

// =============================================================================
// DRIVER API
// =============================================================================
export const driverApi = {
  /**
   * Lấy danh sách đơn hàng của tài xế
   */
  getOrders: (status) => {
    const params = status ? { status } : {};
    return api.get('/drivers/orders', params);
  },
  
  /**
   * Cập nhật trạng thái online/offline
   */
  toggleStatus: (isOnline) => {
    return api.patch('/drivers/status', { isOnline });
  },
  
  /**
   * Lấy lịch sử chuyến đi
   */
  getHistory: (page = 1, limit = 20) => {
    return api.get('/drivers/history', { page, limit });
  },
  
  /**
   * Lấy thống kê
   */
  getStats: () => {
    return api.get('/drivers/stats');
  }
};

// =============================================================================
// ORDER API
// =============================================================================
export const orderApi = {
  /**
   * Cập nhật trạng thái đơn hàng
   */
  updateStatus: (orderId, status, extra = {}) => {
    return api.patch(`/orders/${orderId}/status`, { status, ...extra });
  },
  
  /**
   * Hoàn thành đơn hàng
   */
  complete: (orderId, data) => {
    const formData = new FormData();
    formData.append('status', 'completed');
    
    if (data.notes) {
      formData.append('notes', data.notes);
    }
    if (data.proofImage) {
      formData.append('proofImage', data.proofImage);
    }
    
    return api.postForm(`/orders/${orderId}/complete`, formData);
  },
  
  /**
   * Cập nhật vị trí
   */
  updateLocation: (orderId, lat, lng) => {
    return api.post(`/orders/${orderId}/locations`, { lat, lng });
  },
  
  /**
   * Báo giao thất bại
   */
  reportFailed: (orderId, reason) => {
    return api.patch(`/orders/${orderId}/status`, {
      status: 'failed',
      failureReason: reason
    });
  }
};

// =============================================================================
// Default exports
// =============================================================================
// Backward compatibility - export api as default with methods
export default {
  get: (endpoint, params) => api.get(endpoint, params),
  post: (endpoint, body) => api.post(endpoint, body),
  put: (endpoint, body) => api.put(endpoint, body),
  patch: (endpoint, body) => api.patch(endpoint, body),
  delete: (endpoint) => api.delete(endpoint),
  postForm: (endpoint, formData) => api.postForm(endpoint, formData)
};
