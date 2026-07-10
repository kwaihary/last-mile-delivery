import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { io, Socket } from 'socket.io-client';
import LiveMap from '../components/LiveMap';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

interface Order {
    id: number;
    customer_name: string;
    customer_phone: string;
    address: string;
    latitude: number;
    longitude: number;
    ship_cod: number;
    order_notes: string;
    status: string;
    tracking_token: string;
    created_at: string;
    assigned_at: string;
    started_at: string;
    complete_at: string;
    driver?: {
        id: number;
        full_name: string;
        phone: string;
        driver_profile?: {
            vehicle_type: string;
            license_plate: string;
        };
    };
}

interface DriverData {
    lat: number;
    lng: number;
    status: string;
    active_order_id?: string | number | null;
    full_name?: string;
    vehicle_type?: string;
    license_plate?: string;
    last_ping?: number;
}

interface RouteHistory {
    id: number;
    order_id: number;
    driver_id: number;
    coordinates_path: { lat: number; lng: number; t: number }[];
    total_distance: number;
    driver?: {
        full_name: string;
    };
}

interface Stats {
    total: number;
    completed: number;
    failed: number;
    canceled: number;
    pending: number;
    pickup: number;
    delivering: number;
    totalCOD: number;
    successRate: number;
    dailyStats: { [key: string]: { total: number; completed: number; revenue: number } };
}

const Dashboard = () => {
    // 1. Quản lý trạng thái giao diện
    const [activeTab, setActiveTab] = useState<string>('ALL');
    const [isCreateModalOpenCreateOrder, setIsCreateModalOpenCreateOrder] = useState(false);
    const [isCreateModalOpenReport, setIsCreateModalOpenReport] = useState(false);
    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
    const [isOrderDetailModalOpen, setIsOrderDetailModalOpen] = useState(false);
    const [isRouteHistoryModalOpen, setIsRouteHistoryModalOpen] = useState(false);
    const [isDriverHistoryModalOpen, setIsDriverHistoryModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [routeHistory, setRouteHistory] = useState<RouteHistory[]>([]);
    const [driverStats, setDriverStats] = useState<any[]>([]);

    // 2. Quản lý dữ liệu
    const [orders, setOrders] = useState<Order[]>([]);
    const [driversData, setDriversData] = useState<{ [key: string]: DriverData }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [cancelModal, setCancelModal] = useState({ isOpen: false, orderId: null as number | null, reason: '' });
    const [formData, setFormData] = useState({
        customer_name: '',
        customer_phone: '',
        address: '',
        ship_cod: 0,
        order_notes: ''
    });

    // Filter states
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
    const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, totalPages: 0 });

    // State quản lý Modal Gán đơn
    const [assignModal, setAssignModal] = useState({ isOpen: false, orderId: null as number | null });
    const [driversList, setDriversList] = useState<any[]>([]);
    const [selectedAssignDriverId, setSelectedAssignDriverId] = useState<number | null>(null);

    // State quản lý đơn hàng đang xem lộ trình trên bản đồ
    const [mapSelectedOrderId, setMapSelectedOrderId] = useState<number | null>(null);

    // Stats state
    const [stats, setStats] = useState<Stats | null>(null);

    const navigate = useNavigate();

    // 3. Hàm tạo đơn hàng (Tích hợp Geocoder)
    const handleCreateOrder = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(formData.address)}&format=json&limit=1`, {
                headers: {
                    'Accept-Language': 'vi',
                    'User-Agent': 'DoAnTotNghiep_GiaoHang/1.0'
                }
            });

            if (!response.ok) {
                throw new Error('Geocoding failed');
            }

            const data = await response.json();
            if (!data || data.length === 0) {
                toast.error("Không tìm thấy tọa độ cho địa chỉ này, vui lòng nhập rõ hơn!");
                setIsSubmitting(false);
                return;
            }

            const lat = data[0].lat;
            const lng = data[0].lon;

            await api.post('/orders', {
                ...formData,
                latitude: Number(lat),
                longitude: Number(lng)
            });

            toast.success("Tạo đơn hàng thành công!");
            setIsCreateModalOpenCreateOrder(false);
            fetchOrders();
            fetchStats();
            setFormData({ customer_name: '', customer_phone: '', address: '', ship_cod: 0, order_notes: '' });
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Lỗi khi tạo đơn hàng");
        } finally {
            setIsSubmitting(false);
        }
    };

    // 4. Hàm Hủy Đơn Hàng (sử dụng endpoint mới)
    const triggerCancelOrder = (orderId: number) => {
        setCancelModal({ isOpen: true, orderId, reason: '' });
    };

    const confirmCancelOrder = async () => {
        if (!cancelModal.orderId) return;
        setIsSubmitting(true);

        try {
            await api.patch(`/orders/${cancelModal.orderId}/cancel`, { cancel_reason: cancelModal.reason });
            toast.success(`Đã hủy đơn hàng #ORD-${cancelModal.orderId} thành công!`);
            fetchOrders();
            fetchStats();
            setCancelModal({ isOpen: false, orderId: null, reason: '' });
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Lỗi khi hủy đơn hàng");
        } finally {
            setIsSubmitting(false);
        }
    };

    const confirmLogout = () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('user');
        toast.info('Đã đăng xuất thành công!');
        setIsLogoutModalOpen(false);
        navigate('/login');
    }

    // Fetch stats từ API
    const fetchStats = async () => {
        try {
            const res = await api.get('/orders/stats');
            if (res.data.success && res.data.data) {
                setStats(res.data.data);
            }
        } catch (error) {
            console.error("Lỗi lấy thống kê:", error);
        }
    };

    // Fetch driver stats - use manager endpoint
    const fetchDriverStats = async () => {
        try {
            // Managers should use /users/drivers/stats which returns all drivers' stats
            const res = await api.get('/users/drivers/stats');
            if (res.data?.success && Array.isArray(res.data?.data)) {
                setDriverStats(res.data.data);
            } else {
                setDriverStats([]);
            }
        } catch (error) {
            console.error("Lỗi lấy thống kê tài xế:", error);
            setDriverStats([]); // Ensure it's always an array
        }
    };

    // Gọi API lấy dữ liệu đơn hàng (có filter)
    const fetchOrders = async () => {
        try {
            const params: any = { page: pagination.page, limit: pagination.limit };
            if (statusFilter !== 'all') params.status = statusFilter;
            if (searchQuery) params.search = searchQuery;
            if (selectedDateRange.start) params.start_date = selectedDateRange.start;
            if (selectedDateRange.end) params.end_date = selectedDateRange.end;

            const res = await api.get('/orders', { params });
            const responseData = res.data;
            
            // Backend trả về { success: true, data: { orders, pagination } }
            if (responseData.success && responseData.data) {
                const data = responseData.data;
                // Nếu có pagination, dùng data.orders
                if (data.orders && Array.isArray(data.orders)) {
                    setOrders(data.orders);
                    if (data.pagination) {
                        setPagination(prev => ({ ...prev, ...data.pagination }));
                    }
                } 
                // Nếu không có pagination, data là array trực tiếp
                else if (Array.isArray(data)) {
                    setOrders(data);
                }
            }
        } catch (error) {
            console.error("Lỗi lấy đơn hàng:", error);
            toast.error("Không thể tải danh sách đơn hàng");
        }
    };

    // Lấy danh sách tài xế đang trực tuyến
    const fetchOnlineDrivers = async () => {
        try {
            const res = await api.get('/users/drivers/online');
            const list: any[] = res.data?.data || [];

            setDriversData((prev) => {
                const next = { ...prev };
                list.forEach((d) => {
                    const driverId = String(d.id);
                    const incomingPing = Number(d.last_ping || 0);
                    const currentPing = Number(next[driverId]?.last_ping || 0);
                    if (currentPing > incomingPing) return;

                    next[driverId] = {
                        lat: Number(d.lat),
                        lng: Number(d.lng),
                        status: d.status,
                        active_order_id: d.active_order_id ?? null,
                        full_name: d.full_name,
                        vehicle_type: d.vehicle_type,
                        license_plate: d.license_plate,
                        last_ping: incomingPing || Date.now()
                    };
                });
                return next;
            });
        } catch (error) {
            console.error("Lỗi lấy danh sách tài xế online:", error);
        }
    };

    useEffect(() => {
        fetchOrders();
        fetchStats();
        fetchOnlineDrivers();
        fetchDriverStats();

        const socket: Socket = io(import.meta.env.VITE_SOCKET_URL || (import.meta.env.PROD ? 'https://last-mile-delivery-l7y0.onrender.com' : 'http://localhost:5000'), {
            query: { token: localStorage.getItem('accessToken') }
        });

        const refreshInterval = setInterval(() => {
            fetchOnlineDrivers();
        }, 10000);

        socket.on('LOCATION_UPDATE', (data) => {
            const driverId = String(data.driverId);
            const incomingPing = Number(data.timestamp || Date.now());
            setDriversData(prev => {
                const currentPing = Number(prev[driverId]?.last_ping || 0);
                if (currentPing > incomingPing) return prev;

                return {
                    ...prev,
                    [driverId]: {
                        ...(prev[driverId] || {}),
                        lat: Number(data.lat),
                        lng: Number(data.lng),
                        status: data.status,
                        active_order_id: data.active_order_id,
                        last_ping: incomingPing
                    }
                };
            });
        });

        socket.on('DRIVER_STATUS_UPDATE', (data) => {
            const driverId = String(data.driverId);
            setDriversData(prev => {
                if (data.is_online) {
                    const current = prev[driverId];
                    if (!current) return prev;

                    return {
                        ...prev,
                        [driverId]: {
                            ...current,
                            status: data.status || current.status || 'idle',
                            active_order_id: data.active_order_id ?? current.active_order_id ?? null
                        }
                    };
                }
                const next = { ...prev };
                delete next[driverId];
                return next;
            });
        });

        socket.on('ORDER_STATUS_CHANGED', () => {
            fetchOrders();
            fetchStats();
        });

        socket.on('ORDER_CANCELED', () => {
            fetchOrders();
            fetchStats();
        });

        return () => {
            socket.disconnect();
            clearInterval(refreshInterval);
        };
    }, []);

    // Effect để fetch lại khi filter thay đổi
    useEffect(() => {
        fetchOrders();
    }, [statusFilter, searchQuery, selectedDateRange, pagination.page]);

    // 7. Helper Function: Định dạng UI theo từng trạng thái đơn hàng
    const getOrderStatusUI = (status: string) => {
        switch (status) {
            case 'pending':
                return { border: 'border-l-slate-400', badge: 'bg-slate-100 text-slate-600', text: 'Chờ xử lý' };
            case 'pickup':
                return { border: 'border-l-blue-400', badge: 'bg-blue-100 text-blue-700', text: 'Chờ lấy hàng' };
            case 'delivering':
                return { border: 'border-l-amber-400', badge: 'bg-amber-100 text-amber-700', text: 'Đang giao' };
            case 'completed':
                return { border: 'border-l-emerald-500', badge: 'bg-emerald-100 text-emerald-700', text: 'Thành công' };
            case 'failed':
                return { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700', text: 'Thất bại' };
            case 'canceled':
                return { border: 'border-l-red-500', badge: 'bg-red-100 text-red-700', text: 'Đã hủy' };
            default:
                return { border: 'border-l-slate-400', badge: 'bg-slate-100 text-slate-600', text: status };
        }
    };

    // Open order detail modal + hiển thị lộ trình tài xế trên bản đồ (nếu đơn đang active)
    const openOrderDetail = async (order: Order) => {
        setSelectedOrder(order);
        setIsOrderDetailModalOpen(true);
        // Chỉ hiển thị lộ trình cho đơn đang được tài xế xử lý
        if (['pickup', 'delivering'].includes(order.status)) {
            setMapSelectedOrderId(order.id);
        } else {
            setMapSelectedOrderId(null);
        }
    };

    // Open route history for an order
    const openRouteHistory = async (orderId: number) => {
        try {
            const res = await api.get(`/orders/${orderId}/route-history`);
            setRouteHistory(res.data.data || []);
            setIsRouteHistoryModalOpen(true);
        } catch (error) {
            toast.error("Không thể tải lịch sử lộ trình");
        }
    };

    // 4.3 Mở Modal Gán Đơn và lấy danh sách tài xế
    const openAssignModal = async (orderId: number) => {
        setAssignModal({ isOpen: true, orderId });
        setSelectedAssignDriverId(null);
        try {
            const res = await api.get('/users/drivers');
            setDriversList(res.data.data);
        } catch (error: any) {
            toast.error("Không thể tải danh sách tài xế!");
        }
    };

    const getDriverOnlineStatus = (driver: any) => {
        return !!driversData[driver.id];
    };

    const handleSelectDriver = (driverId: number) => {
        const driver = driversList.find(item => item.id === driverId);
        if (!driver) return;
        const isOnline = getDriverOnlineStatus(driver);
        if (!isOnline) {
            toast.error("Tài xế này đang offline, không thể gán đơn.");
            return;
        }
        setSelectedAssignDriverId(driverId);
    };

    // 4.4 Thực thi Gán Đơn
    const confirmAssignOrder = async () => {
        if (!assignModal.orderId || !selectedAssignDriverId) return;
        const selectedDriver = driversList.find(driver => driver.id === selectedAssignDriverId);
        if (selectedDriver && !getDriverOnlineStatus(selectedDriver)) {
            toast.error("Tài xế này đang offline, không thể gán đơn.");
            return;
        }
        setIsSubmitting(true);
        try {
            await api.patch(`/orders/${assignModal.orderId}/assign`, { driver_id: selectedAssignDriverId });
            toast.success(`Đã gán đơn hàng cho tài xế thành công!`);
            fetchOrders();
            setAssignModal({ isOpen: false, orderId: null });
            setSelectedAssignDriverId(null);
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Lỗi khi gán đơn hàng");
        } finally {
            setIsSubmitting(false);
        }
    };

    // Filter orders for display
    const filteredOrders = orders.filter(o => {
        if (activeTab === 'PENDING' && o.status !== 'pending') return false;
        return true;
    });

    // Format currency
    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
    };

    // Format date
    const formatDate = (dateStr: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleString('vi-VN');
    };

    return (
        <div className="bg-slate-100 h-screen w-full flex overflow-hidden relative">
            {/* Blur Overlays */}
            <div className={`absolute inset-0 z-40 bg-slate-900/20 backdrop-blur-sm transition-all duration-300 ${isCreateModalOpenCreateOrder || isCreateModalOpenReport || cancelModal.isOpen || assignModal.isOpen || isLogoutModalOpen || isOrderDetailModalOpen || isRouteHistoryModalOpen || isDriverHistoryModalOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}></div>

            {/* Sidebar */}
            <aside className="w-96 bg-white shadow-2xl flex flex-col shrink-0 relative z-30">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-800 text-white">
                    <div>
                        <h1 className="text-lg font-bold">Điều Phối Trung Tâm</h1>
                        <p className="text-xs text-slate-300 flex items-center gap-1 mt-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            Hệ thống Online
                        </p>
                    </div>
                    <button
                        onClick={() => setIsLogoutModalOpen(true)}
                        className="text-slate-400 hover:text-red-400 transition-colors"
                        title="Đăng xuất"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                        </svg>
                    </button>
                </div>

                {/* Filter Section */}
                <div className="p-3 border-b border-slate-100 space-y-2">
                    <div className="flex space-x-2 bg-slate-100 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('ALL')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === 'ALL' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                            Tất cả
                        </button>
                        <button
                            onClick={() => setActiveTab('PENDING')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === 'PENDING' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                            Chờ gán
                        </button>
                        <button
                            onClick={() => setActiveTab('DELIVERING')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${activeTab === 'DELIVERING' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                            Đang giao
                        </button>
                    </div>
                    
                    {/* Search */}
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Tìm theo SĐT, tên..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-1 outline-none"
                        />
                        <svg className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                        </svg>
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-blue-500 outline-none"
                    >
                        <option value="all">Tất cả trạng thái</option>
                        <option value="pending">Chờ xử lý</option>
                        <option value="pickup">Chờ lấy hàng</option>
                        <option value="delivering">Đang giao</option>
                        <option value="completed">Thành công</option>
                        <option value="failed">Thất bại</option>
                        <option value="canceled">Đã hủy</option>
                    </select>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-8 text-slate-500">
                            <p>Không có đơn hàng nào</p>
                        </div>
                    ) : (
                        filteredOrders.map((order: Order) => {
                            const ui = getOrderStatusUI(order.status);
                            const canCancel = ['pending', 'pickup', 'delivering'].includes(order.status);
                            const isCompletedOrCanceled = ['completed', 'canceled', 'failed'].includes(order.status);

                            return (
                                <div key={order.id} 
                                    onClick={() => openOrderDetail(order)}
                                    className={`bg-white p-3 rounded-xl border border-slate-200 shadow-sm cursor-pointer border-l-4 ${ui.border} hover:shadow-md transition-all relative`}>
                                    {/* Nút Hủy Đơn */}
                                    {canCancel && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); triggerCancelOrder(order.id); }}
                                            className="absolute top-2 right-2 text-slate-300 hover:text-red-500 transition-colors"
                                            title="Hủy đơn hàng"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                            </svg>
                                        </button>
                                    )}

                                    <div className="flex justify-between items-center mb-1.5 pr-6">
                                        <span className="font-bold text-slate-800 text-xs">#ORD-{order.id}</span>
                                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full uppercase ${ui.badge}`}>{ui.text}</span>
                                    </div>
                                    <p className="text-xs text-slate-500 mb-2 truncate">{order.address}</p>
                                    <p className="text-xs font-semibold text-slate-700 mb-2">COD: {formatCurrency(order.ship_cod)}</p>

                                    {order.status === 'pending' && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); openAssignModal(order.id); }}
                                            className="w-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                        >
                                            Gán đơn
                                        </button>
                                    )}

                                    {isCompletedOrCanceled && (
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); openRouteHistory(order.id); }}
                                            className="w-full bg-slate-100 text-slate-600 hover:bg-slate-200 border border-slate-200 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                                        >
                                            Xem lộ trình
                                        </button>
                                    )}
                                </div>
                            );
                        })
                    )}

                    {/* Pagination */}
                    {pagination.totalPages > 1 && (
                        <div className="flex justify-center items-center gap-2 py-3">
                            <button
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                                disabled={pagination.page === 1}
                                className="px-3 py-1 text-xs rounded bg-slate-200 disabled:opacity-50"
                            >
                                Prev
                            </button>
                            <span className="text-xs text-slate-600">
                                {pagination.page} / {pagination.totalPages}
                            </span>
                            <button
                                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                                disabled={pagination.page === pagination.totalPages}
                                className="px-3 py-1 text-xs rounded bg-slate-200 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>

                <div className="p-4 border-slate-100 flex justify-between gap-2 items-center bg-slate-800 text-white">
                    <button
                        onClick={() => setIsDriverHistoryModalOpen(true)}
                        className="flex-1 py-2.5 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-xl text-xs transition-colors flex items-center justify-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
                        </svg>
                        Tài xế
                    </button>
                    <button
                        onClick={() => setIsCreateModalOpenCreateOrder(true)}
                        className="flex-1 py-2.5 bg-blue-600 text-white font-bold rounded-xl text-xs active:bg-blue-700 transition-colors">
                        TẠO ĐƠN
                    </button>
                    <button
                        onClick={() => { fetchStats(); setIsCreateModalOpenReport(true); }}
                        className="flex-1 py-2.5 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-xl text-xs transition-colors">
                        THỐNG KÊ
                    </button>
                </div>
            </aside>

            {/* Khu vực Bản đồ */}
            <main className="flex-1 relative bg-[#e5e3df]">
                <LiveMap
                    driversData={driversData}
                    ordersData={orders}
                    selectedOrderId={mapSelectedOrderId}
                    onClearSelectedOrder={() => setMapSelectedOrderId(null)}
                />
            </main>

            {/* Modal Tạo Đơn Hàng */}
            {isCreateModalOpenCreateOrder && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <form onSubmit={handleCreateOrder} className="p-8 space-y-6 max-h-[90vh] overflow-y-auto">
                        <h2 className="text-2xl font-black text-slate-800 border-b pb-4">Tạo Đơn Hàng Mới</h2>

                        <div>
                            <h3 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                                <span className="w-5 h-5 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs">1</span>
                                Thông tin Khách hàng
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Tên người nhận <span className="text-red-500">*</span></label>
                                    <input type="text" required value={formData.customer_name} onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: Nguyễn Văn A" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Số điện thoại <span className="text-red-500">*</span></label>
                                    <input type="tel" required value={formData.customer_phone} onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: 0901234567" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Địa chỉ giao hàng <span className="text-red-500">*</span></label>
                                    <input type="text" required value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: 65 Huỳnh Thúc Kháng, Bến Nghé, Quận 1, Hồ Chí Minh" />
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-base font-bold text-slate-800 mb-3 flex items-center gap-2">
                                <span className="w-5 h-5 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-xs">2</span>
                                Chi tiết gói hàng
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Tiền thu hộ (COD)</label>
                                    <input type="number" min="0" value={formData.ship_cod} onChange={(e) => setFormData({ ...formData, ship_cod: Number(e.target.value) })} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="0 VNĐ" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1">Ghi chú cho Tài xế</label>
                                    <textarea rows={2} value={formData.order_notes} onChange={(e) => setFormData({ ...formData, order_notes: e.target.value })} className="w-full px-3 py-2.5 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: Khách hàng chỉ nhận giờ hành chính..."></textarea>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-3 mt-4">
                            <button type="button" onClick={() => setIsCreateModalOpenCreateOrder(false)} className="px-5 py-2.5 font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">Hủy bỏ</button>
                            <button type="submit" disabled={isSubmitting} className={`px-6 py-2.5 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 ${isSubmitting ? 'bg-slate-400' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}>
                                {isSubmitting ? 'Đang xử lý...' : 'Tạo đơn ngay'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Modal Báo Cáo Thống Kê */}
            {isCreateModalOpenReport && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-5xl bg-slate-50 rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-end mb-6">
                            <div>
                                <h2 className="text-2xl font-black text-slate-800">Tổng quan hiệu suất</h2>
                                <p className="text-slate-500 text-sm mt-1">Dữ liệu được cập nhật theo thời gian thực.</p>
                            </div>
                            <button onClick={() => setIsCreateModalOpenReport(false)} className="px-4 py-2 text-slate-600 bg-slate-200 hover:bg-slate-300 font-bold rounded-lg transition-colors">
                                Đóng
                            </button>
                        </div>

                        {!stats ? (
                            <div className="text-center py-16 text-slate-500">
                                <svg className="w-8 h-8 mx-auto mb-3 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                                <p>Đang tải dữ liệu thống kê...</p>
                            </div>
                        ) : (
                        <>
                        <div className="grid grid-cols-4 gap-4 mb-6">
                            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                                <p className="text-slate-500 font-medium text-xs">Tổng đơn hàng</p>
                                <p className="text-3xl font-black text-slate-800 mt-1">{stats.total}</p>
                            </div>
                            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                                <p className="text-slate-500 font-medium text-xs">Tỷ lệ thành công</p>
                                <p className="text-3xl font-black text-emerald-600 mt-1">{stats.successRate}%</p>
                            </div>
                            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                                <p className="text-slate-500 font-medium text-xs">Tài xế Online</p>
                                <p className="text-3xl font-black text-slate-800 mt-1">{Object.keys(driversData).length}</p>
                            </div>
                            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                                <p className="text-slate-500 font-medium text-xs">Tổng thu COD</p>
                                <p className="text-2xl font-black text-purple-600 mt-1">{formatCurrency(stats.totalCOD)}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                                <h3 className="font-bold text-slate-800 mb-4 text-sm">Trạng thái xử lý</h3>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center text-xs border-b pb-2">
                                        <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-3 h-3 rounded-full bg-emerald-500"></span> Thành công</span>
                                        <span className="font-black text-slate-800">{stats.completed} Đơn</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs border-b pb-2">
                                        <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-3 h-3 rounded-full bg-amber-500"></span> Đang giao</span>
                                        <span className="font-black text-slate-800">{stats.delivering} Đơn</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs border-b pb-2">
                                        <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-3 h-3 rounded-full bg-blue-500"></span> Chờ lấy hàng</span>
                                        <span className="font-black text-slate-800">{stats.pickup} Đơn</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs border-b pb-2">
                                        <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-3 h-3 rounded-full bg-slate-400"></span> Chờ gán đơn</span>
                                        <span className="font-black text-slate-800">{stats.pending} Đơn</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-3 h-3 rounded-full bg-red-500"></span> Hủy/Thất bại</span>
                                        <span className="font-black text-slate-800">{stats.failed + stats.canceled} Đơn</span>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                                <h3 className="font-bold text-slate-800 mb-4 text-sm">Thống kê Tài xế</h3>
                                <div className="space-y-2 max-h-48 overflow-y-auto">
                                    {driverStats.length === 0 ? (
                                        <p className="text-xs text-slate-500 text-center py-4">Chưa có dữ liệu tài xế</p>
                                    ) : (
                                        driverStats.map((driver: any) => (
                                            <div key={driver.driver_id} className="flex justify-between items-center text-xs border-b border-slate-100 pb-2">
                                                <div>
                                                    <p className="font-semibold text-slate-700">{driver.driver_name}</p>
                                                    <p className="text-slate-400 text-[10px]">{driver.vehicle_type} • {driver.license_plate}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-emerald-600">{driver.total_deliveries} đơn</p>
                                                    <p className="text-slate-400 text-[10px]">{driver.total_distance_km} km</p>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                        </>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Chi Tiết Đơn Hàng */}
            {isOrderDetailModalOpen && selectedOrder && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-4 border-b pb-3">
                            <h3 className="text-xl font-bold text-slate-800">Chi tiết đơn hàng #ORD-{selectedOrder.id}</h3>
                            <button onClick={() => setIsOrderDetailModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="bg-slate-50 p-3 rounded-lg">
                                <p className="text-xs text-slate-500 mb-1">Trạng thái</p>
                                <span className={`px-3 py-1 text-xs font-bold rounded-full uppercase ${getOrderStatusUI(selectedOrder.status).badge}`}>
                                    {getOrderStatusUI(selectedOrder.status).text}
                                </span>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs text-slate-500">Khách hàng</p>
                                    <p className="font-semibold text-slate-800">{selectedOrder.customer_name}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500">Số điện thoại</p>
                                    <p className="font-semibold text-slate-800">{selectedOrder.customer_phone}</p>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs text-slate-500">Địa chỉ giao hàng</p>
                                <p className="font-semibold text-slate-800">{selectedOrder.address}</p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-xs text-slate-500">Tiền thu hộ (COD)</p>
                                    <p className="font-bold text-lg text-emerald-600">{formatCurrency(selectedOrder.ship_cod)}</p>
                                </div>
                                {selectedOrder.driver && (
                                    <div>
                                        <p className="text-xs text-slate-500">Tài xế</p>
                                        <p className="font-semibold text-slate-800">{selectedOrder.driver.full_name}</p>
                                        <p className="text-xs text-slate-500">{selectedOrder.driver.driver_profile?.vehicle_type}</p>
                                    </div>
                                )}
                            </div>

                            {selectedOrder.order_notes && (
                                <div>
                                    <p className="text-xs text-slate-500">Ghi chú</p>
                                    <p className="text-sm text-slate-700 bg-amber-50 p-2 rounded">{selectedOrder.order_notes}</p>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 text-xs text-slate-500">
                                <div>
                                    <p>Tạo đơn:</p>
                                    <p className="text-slate-700">{formatDate(selectedOrder.created_at)}</p>
                                </div>
                                {selectedOrder.assigned_at && (
                                    <div>
                                        <p>Gán đơn:</p>
                                        <p className="text-slate-700">{formatDate(selectedOrder.assigned_at)}</p>
                                    </div>
                                )}
                                {selectedOrder.started_at && (
                                    <div>
                                        <p>Bắt đầu giao:</p>
                                        <p className="text-slate-700">{formatDate(selectedOrder.started_at)}</p>
                                    </div>
                                )}
                                {selectedOrder.complete_at && (
                                    <div>
                                        <p>Hoàn thành:</p>
                                        <p className="text-slate-700">{formatDate(selectedOrder.complete_at)}</p>
                                    </div>
                                )}
                            </div>

                            {['completed', 'canceled', 'failed'].includes(selectedOrder.status) && (
                                <button
                                    onClick={() => { setIsOrderDetailModalOpen(false); openRouteHistory(selectedOrder.id); }}
                                    className="w-full py-2.5 bg-slate-100 text-slate-700 font-semibold rounded-lg hover:bg-slate-200 transition-colors"
                                >
                                    Xem lịch sử lộ trình
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Lịch Sử Lộ Trình */}
            {isRouteHistoryModalOpen && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-4 border-b pb-3">
                            <h3 className="text-xl font-bold text-slate-800">Lịch sử lộ trình</h3>
                            <button onClick={() => setIsRouteHistoryModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        {routeHistory.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                <p>Không có dữ liệu lộ trình</p>
                            </div>
                        ) : (
                            <div className="space-y-4 max-h-96 overflow-y-auto">
                                {routeHistory.map((route: RouteHistory) => (
                                    <div key={route.id} className="bg-slate-50 p-4 rounded-xl">
                                        <div className="flex justify-between items-center mb-2">
                                            <p className="font-semibold text-slate-800">
                                                {route.driver?.full_name || `Tài xế #${route.driver_id}`}
                                            </p>
                                            <span className="text-emerald-600 font-bold">{route.total_distance} km</span>
                                        </div>
                                        <p className="text-xs text-slate-500">
                                            {route.coordinates_path?.length || 0} điểm GPS • #{route.order_id}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Thống Kê Tài Xế */}
            {isDriverHistoryModalOpen && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-4 border-b pb-3">
                            <h3 className="text-xl font-bold text-slate-800">Thống kê Tài xế</h3>
                            <button onClick={() => setIsDriverHistoryModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>

                        {driverStats.length === 0 ? (
                            <div className="text-center py-8 text-slate-500">
                                <p>Chưa có dữ liệu tài xế</p>
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-96 overflow-y-auto">
                                {driverStats.map((driver: any) => (
                                    <div key={driver.driver_id} className="bg-slate-50 p-4 rounded-xl flex justify-between items-center">
                                        <div>
                                            <p className="font-bold text-slate-800">{driver.driver_name}</p>
                                            <p className="text-xs text-slate-500">{driver.vehicle_type} • {driver.license_plate}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-emerald-600 font-bold">{driver.total_deliveries} đơn</p>
                                            <p className="text-xs text-slate-500">{driver.total_distance_km} km</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modal Xác Nhận Hủy Đơn Hàng */}
            {cancelModal.isOpen && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6 text-center">
                        <div className="w-14 h-14 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                            </svg>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mb-2">Xác nhận hủy đơn</h3>
                        <p className="text-slate-500 mb-4 text-sm">
                            Bạn có chắc chắn muốn hủy đơn hàng <span className="font-bold text-slate-700">#ORD-{cancelModal.orderId}</span>?
                        </p>

                        <div className="mb-4">
                            <label className="block text-sm font-semibold text-slate-700 mb-1 text-left">Lý do hủy (tùy chọn)</label>
                            <textarea
                                rows={2}
                                value={cancelModal.reason}
                                onChange={(e) => setCancelModal({ ...cancelModal, reason: e.target.value })}
                                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:border-red-500 outline-none"
                                placeholder="Nhập lý do hủy đơn..."
                            />
                        </div>

                        <div className="flex justify-center gap-3">
                            <button
                                onClick={() => setCancelModal({ isOpen: false, orderId: null, reason: '' })}
                                className="px-5 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Đóng
                            </button>
                            <button
                                onClick={confirmCancelOrder}
                                disabled={isSubmitting}
                                className={`px-5 py-2.5 font-bold text-white rounded-xl shadow-lg transition-colors ${isSubmitting ? 'bg-red-300' : 'bg-red-500 hover:bg-red-600'}`}
                            >
                                {isSubmitting ? 'Đang xử lý...' : 'Đồng ý hủy'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Gán Đơn Hàng */}
            {assignModal.isOpen && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-5">
                        <div className="flex justify-between items-center mb-4 border-b pb-3">
                            <h3 className="text-lg font-bold text-slate-800">Gán đơn #ORD-{assignModal.orderId}</h3>
                            <button onClick={() => setAssignModal({ isOpen: false, orderId: null })} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        
                        <div className="max-h-[40vh] overflow-y-auto space-y-2 pr-2">
                            {driversList.length === 0 ? (
                                <p className="text-center text-slate-500 py-4">Không tìm thấy tài xế nào...</p>
                            ) : (
                                driversList.map(driver => {
                                    const isOnline = getDriverOnlineStatus(driver);
                                    const isSelected = selectedAssignDriverId === driver.id;
                                    return (
                                        <div 
                                            key={driver.id} 
                                            onClick={() => handleSelectDriver(driver.id)}
                                            className={`p-3 border rounded-lg cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300'} ${!isOnline ? 'opacity-60' : ''}`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center text-sm">🛵</div>
                                                <div>
                                                    <p className="font-bold text-slate-800 text-sm">{driver.full_name}</p>
                                                    <p className="text-xs text-slate-500">{driver.driver_profile?.vehicle_type} • {driver.driver_profile?.license_plate}</p>
                                                </div>
                                            </div>
                                            {isOnline ? (
                                                <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Online
                                                </span>
                                            ) : (
                                                <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Offline</span>
                                            )}
                                        </div>
                                    )
                                })
                            )}
                        </div>
                        
                        <div className="flex justify-end gap-2 mt-4 pt-3 border-t">
                            <button onClick={() => setAssignModal({ isOpen: false, orderId: null })} className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors text-sm">Hủy</button>
                            <button 
                                onClick={confirmAssignOrder}
                                disabled={!selectedAssignDriverId || isSubmitting}
                                className={`px-4 py-2 font-bold text-white rounded-lg transition-colors text-sm ${(!selectedAssignDriverId || isSubmitting) ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700'}`}
                            >
                                {isSubmitting ? 'Đang xử lý...' : 'Xác nhận gán'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Xác Nhận Đăng Xuất */}
            {isLogoutModalOpen && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6 text-center">
                        <div className="w-14 h-14 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                            </svg>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mb-2">Đăng xuất</h3>
                        <p className="text-slate-500 mb-5 text-sm">Bạn có chắc chắn muốn đăng xuất?</p>

                        <div className="flex justify-center gap-3">
                            <button
                                onClick={() => setIsLogoutModalOpen(false)}
                                className="px-5 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Đóng
                            </button>
                            <button
                                onClick={confirmLogout}
                                className="px-5 py-2.5 font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors">
                                Đăng xuất
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;
