import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { io, Socket } from 'socket.io-client';
import LiveMap from '../components/LiveMap';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';
const Dashboard = () => {
    // 1. Quản lý trạng thái giao diện
    const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING'>('ALL');
    const [isCreateModalOpenCreateOrder, setIsCreateModalOpenCreateOrder] = useState(false);
    const [isCreateModalOpenReport, setIsCreateModalOpenReport] = useState(false);
    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

    // 2. Quản lý dữ liệu
    const [orders, setOrders] = useState<any[]>([]);
    const [driversData, setDriversData] = useState<{ [key: string]: any }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [cancelModal, setCancelModal] = useState({ isOpen: false, orderId: null as number | null });
    const [formData, setFormData] = useState({
        customer_name: '',
        customer_phone: '',
        address: '',
        ship_cod: 0,
        order_notes: ''
    });

    // State quản lý Modal Gán đơn
    const [assignModal, setAssignModal] = useState({ isOpen: false, orderId: null as number | null });
    const [driversList, setDriversList] = useState<any[]>([]); // Danh sách tài xế
    const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null); // Tài xế được chọn

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
            setFormData({ customer_name: '', customer_phone: '', address: '', ship_cod: 0, order_notes: '' });
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Lỗi khi tạo đơn hàng");
        } finally {
            setIsSubmitting(false);
        }
    };

    // 4. Hàm Hủy Đơn Hàng
    // 4.1 Hàm kích hoạt mở Modal xác nhận hủy
    const triggerCancelOrder = (orderId: number) => {
        setCancelModal({ isOpen: true, orderId });
    };

    // 4.2 Hàm thực thi gọi API Hủy đơn (chạy khi bấm Đồng ý trong Modal)
    const confirmCancelOrder = async () => {
        if (!cancelModal.orderId) return;
        setIsSubmitting(true);

        try {
            await api.patch(`/orders/${cancelModal.orderId}/status`, { status: 'canceled' });
            toast.success(`Đã hủy đơn hàng #ORD-${cancelModal.orderId} thành công!`);
            fetchOrders();
            setCancelModal({ isOpen: false, orderId: null });
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

    // 5. Tính toán dữ liệu thống kê (Lấy thực tế từ mảng orders và drivers)
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o: any) => o.status === 'completed').length;
    const successRate = totalOrders === 0 ? 0 : ((completedOrders / totalOrders) * 100).toFixed(1);
    const totalCOD = orders.reduce((sum: number, o: any) => sum + Number(o.ship_cod || 0), 0);
    const formattedCOD = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalCOD);
    const activeDriversCount = Object.keys(driversData).length;

    // Gọi API lấy dữ liệu và Cấu hình Socket (Đã gộp chung 1 useEffect)
    const fetchOrders = async () => {
        try {
            const res = await api.get('/orders');
            const sortedOrders = res.data.data.sort((a: any, b: any) => b.id - a.id);
            setOrders(sortedOrders);
        } catch (error) {
            console.error("Lỗi lấy đơn hàng:", error);
        }
    };

    useEffect(() => {
        fetchOrders();

        // Đảm bảo sử dụng token 'accessToken' như khi đăng nhập
        const socket: Socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000', {
            query: { token: localStorage.getItem('accessToken') }
        });

        socket.on('LOCATION_UPDATE', (data) => {
            setDriversData(prev => ({
                ...prev,
                [data.driverId]: {
                    lat: data.lat,
                    lng: data.lng,
                    status: data.status,
                    active_order_id: data.active_order_id
                }
            }));
        });

        socket.on('DRIVER_STATUS_UPDATE', (data) => {
            setDriversData(prev => {
                if (data.is_online) {
                    return {
                        ...prev,
                        [data.driverId]: {
                            lat: prev[data.driverId]?.lat ?? 10.762622,
                            lng: prev[data.driverId]?.lng ?? 106.660172,
                            status: data.status || 'idle',
                            active_order_id: data.active_order_id ?? prev[data.driverId]?.active_order_id ?? null
                        }
                    };
                }

                const next = { ...prev };
                delete next[data.driverId];
                return next;
            });
        });

        return () => {
            socket.disconnect();
        };
    }, []);

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

    // 4.3 Mở Modal Gán Đơn và lấy danh sách tài xế
    const openAssignModal = async (orderId: number) => {
        setAssignModal({ isOpen: true, orderId });
        setSelectedDriverId(null); // Reset lựa chọn cũ
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
        setSelectedDriverId(driverId);
    };

    // 4.4 Thực thi Gán Đơn
    const confirmAssignOrder = async () => {
        if (!assignModal.orderId || !selectedDriverId) return;
        const selectedDriver = driversList.find(driver => driver.id === selectedDriverId);
        if (selectedDriver && !getDriverOnlineStatus(selectedDriver)) {
            toast.error("Tài xế này đang offline, không thể gán đơn.");
            return;
        }
        setIsSubmitting(true);
        try {
            await api.patch(`/orders/${assignModal.orderId}/assign`, { driver_id: selectedDriverId });
            toast.success(`Đã gán đơn hàng cho tài xế thành công!`);
            fetchOrders();
            setAssignModal({ isOpen: false, orderId: null });
            setSelectedDriverId(null);
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Lỗi khi gán đơn hàng");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="bg-slate-100 h-screen w-full flex overflow-hidden relative">
            {/* Blur Overlays */}
            <div className={`absolute inset-0 z-40 bg-slate-900/20 backdrop-blur-sm transition-all duration-300 ${isCreateModalOpenCreateOrder || isCreateModalOpenReport || cancelModal.isOpen || assignModal.isOpen || isLogoutModalOpen ? 'opacity-100 visible' : 'opacity-0 invisible'}`}></div>

            {/* Sidebar */}
            <aside className="w-80 bg-white shadow-2xl flex flex-col shrink-0 relative z-30">
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

                <div className="p-4 border-b border-slate-100">
                    <div className="flex space-x-2 bg-slate-100 p-1 rounded-lg">
                        <button
                            onClick={() => setActiveTab('ALL')}
                            className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${activeTab === 'ALL' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                            Tất cả
                        </button>
                        <button
                            onClick={() => setActiveTab('PENDING')}
                            className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-all ${activeTab === 'PENDING' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                            Chờ gán
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                    {orders.filter(o => activeTab === 'ALL' || o.status === 'pending').map((order: any) => {
                        const ui = getOrderStatusUI(order.status);
                        const canCancel = ['pending', 'pickup', 'delivering'].includes(order.status);

                        return (
                            <div key={order.id} className={`bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer border-l-4 ${ui.border} hover:shadow-md transition-all relative`}>
                                {/* Nút Hủy Đơn */}
                                {canCancel && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); triggerCancelOrder(order.id); }}
                                        className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors"
                                        title="Hủy đơn hàng"
                                    >
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                                        </svg>
                                    </button>
                                )}

                                <div className="flex justify-between items-center mb-2 pr-8">
                                    <span className="font-bold text-slate-800 text-sm">#ORD-{order.id}</span>
                                    <span className={`px-2.5 py-1 text-[11px] font-bold rounded-full uppercase ${ui.badge}`}>{ui.text}</span>
                                </div>
                                <p className="text-xs text-slate-500 mb-3"><span className="font-semibold text-slate-700">Đến:</span> {order.address}</p>

                                {order.status === 'pending' && (
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); openAssignModal(order.id); }}
                                        className="w-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 py-2 rounded-lg text-sm font-semibold transition-colors"
                                    >
                                        Gán đơn
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="p-5 border-slate-100 flex justify-between gap-3 items-center bg-slate-800 text-white">
                    <button
                        onClick={() => setIsCreateModalOpenCreateOrder(true)}
                        className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl text-sm active:bg-blue-700 transition-colors">
                        TẠO ĐƠN
                    </button>
                    <button
                        onClick={() => setIsCreateModalOpenReport(true)}
                        className="flex-1 py-3 bg-slate-600 hover:bg-slate-500 text-white font-bold rounded-xl text-sm transition-colors">
                        THỐNG KÊ
                    </button>
                </div>
            </aside>

            {/* Khu vực Bản đồ */}
            <main className="flex-1 relative bg-[#e5e3df]">
                <LiveMap driversData={driversData} ordersData={orders} />
            </main>

            {/* Modal Tạo Đơn Hàng */}
            {isCreateModalOpenCreateOrder && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <form onSubmit={handleCreateOrder} className="p-8 space-y-6 max-h-[90vh] overflow-y-auto">
                        <h2 className="text-3xl font-black text-slate-800 border-b pb-4">Tạo Đơn Hàng Mới</h2>

                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <span className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm">1</span>
                                Thông tin Khách hàng
                            </h3>
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Tên người nhận <span className="text-red-500">*</span></label>
                                    <input type="text" required value={formData.customer_name} onChange={(e) => setFormData({ ...formData, customer_name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: Nguyễn Văn A" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Số điện thoại <span className="text-red-500">*</span></label>
                                    <input type="tel" required value={formData.customer_phone} onChange={(e) => setFormData({ ...formData, customer_phone: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: 0901234567" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Địa chỉ giao hàng (Cụ thể để Map quét Tọa độ) <span className="text-red-500">*</span></label>
                                    <input type="text" required value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: 65 Huỳnh Thúc Kháng, Bến Nghé, Quận 1, Hồ Chí Minh" />
                                </div>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <span className="w-6 h-6 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-sm">2</span>
                                Chi tiết gói hàng
                            </h3>
                            <div className="grid grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Tiền thu hộ (COD)</label>
                                    <input type="number" min="0" value={formData.ship_cod} onChange={(e) => setFormData({ ...formData, ship_cod: Number(e.target.value) })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="0 VNĐ" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Ghi chú cho Tài xế</label>
                                    <textarea rows={3} value={formData.order_notes} onChange={(e) => setFormData({ ...formData, order_notes: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-2 outline-none bg-slate-50" placeholder="VD: Khách hàng chỉ nhận giờ hành chính..."></textarea>
                                </div>
                            </div>
                        </div>

                        <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-4 mt-6">
                            <button type="button" onClick={() => setIsCreateModalOpenCreateOrder(false)} className="px-6 py-3 font-semibold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">Hủy bỏ</button>
                            <button type="submit" disabled={isSubmitting} className={`px-8 py-3 text-white font-bold rounded-xl shadow-lg transition-colors flex items-center gap-2 ${isSubmitting ? 'bg-slate-400' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}>
                                {isSubmitting ? 'Đang xử lý...' : 'Tạo đơn ngay'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Modal Báo Cáo Thống Kê */}
            {isCreateModalOpenReport && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-5xl bg-slate-50 rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-8 max-h-[85vh] overflow-y-auto">
                        <div className="flex justify-between items-end mb-8">
                            <div>
                                <h2 className="text-3xl font-black text-slate-800">Tổng quan hiệu suất</h2>
                                <p className="text-slate-500 mt-1">Dữ liệu được cập nhật theo thời gian thực (Real-time).</p>
                            </div>
                            <button onClick={() => setIsCreateModalOpenReport(false)} className="px-5 py-2 text-slate-600 bg-slate-200 hover:bg-slate-300 font-bold rounded-lg transition-colors">
                                Đóng báo cáo
                            </button>
                        </div>

                        <div className="grid grid-cols-4 gap-6 mb-8">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="w-12 h-12 mb-4 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-2xl">📦</div>
                                <p className="text-slate-500 font-medium text-sm">Tổng đơn hàng</p>
                                <p className="text-4xl font-black text-slate-800 mt-1">{totalOrders}</p>
                            </div>

                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="w-12 h-12 mb-4 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-2xl">✅</div>
                                <p className="text-slate-500 font-medium text-sm">Tỷ lệ thành công</p>
                                <p className="text-4xl font-black text-slate-800 mt-1">{successRate}%</p>
                            </div>

                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="w-12 h-12 mb-4 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-2xl">🛵</div>
                                <p className="text-slate-500 font-medium text-sm">Tài xế đang Online</p>
                                <p className="text-4xl font-black text-slate-800 mt-1">{activeDriversCount}</p>
                            </div>

                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="w-12 h-12 mb-4 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center text-2xl">💰</div>
                                <p className="text-slate-500 font-medium text-sm">Tổng thu COD</p>
                                <p className="text-3xl font-black text-slate-800 mt-1">{formattedCOD}</p>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <h3 className="font-bold text-slate-800 mb-6">Trạng thái xử lý</h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-emerald-500"></span> Thành công</span>
                                    <span className="font-black text-slate-800">{completedOrders} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-amber-500"></span> Đang giao</span>
                                    <span className="font-black text-slate-800">{orders.filter((o: any) => o.status === 'delivering').length} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-blue-500"></span> Chờ lấy hàng</span>
                                    <span className="font-black text-slate-800">{orders.filter((o: any) => o.status === 'pickup').length} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-slate-400"></span> Chờ gán đơn</span>
                                    <span className="font-black text-slate-800">{orders.filter((o: any) => o.status === 'pending').length} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-red-500"></span> Hủy/Thất bại</span>
                                    <span className="font-black text-slate-800">{orders.filter((o: any) => o.status === 'failed' || o.status === 'canceled').length} Đơn</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Xác Nhận Hủy Đơn Hàng */}
            {cancelModal.isOpen && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    <div className="p-6 text-center">
                        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            {/* Icon Cảnh báo */}
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">Xác nhận hủy đơn</h3>
                        <p className="text-slate-500 mb-6 text-sm">
                            Bạn có chắc chắn muốn hủy đơn hàng <span className="font-bold text-slate-700">#ORD-{cancelModal.orderId}</span>? Hành động này không thể hoàn tác.
                        </p>

                        <div className="flex justify-center gap-3">
                            <button
                                onClick={() => setCancelModal({ isOpen: false, orderId: null })}
                                className="px-6 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Đóng
                            </button>
                            <button
                                onClick={confirmCancelOrder}
                                disabled={isSubmitting}
                                className={`px-6 py-2.5 font-bold text-white rounded-xl shadow-lg transition-colors ${isSubmitting ? 'bg-red-300' : 'bg-red-500 hover:bg-red-600 shadow-red-200'}`}
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
                    <div className="p-6">
                        <div className="flex justify-between items-center mb-4 border-b pb-3">
                            <h3 className="text-xl font-bold text-slate-800">Gán đơn hàng #ORD-{assignModal.orderId}</h3>
                            <button onClick={() => setAssignModal({ isOpen: false, orderId: null })} className="text-slate-400 hover:text-slate-600">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                        </div>
                        
                        <div className="max-h-[50vh] overflow-y-auto space-y-3 pr-2">
                            {driversList.length === 0 ? (
                                <p className="text-center text-slate-500 py-4">Không tìm thấy tài xế nào trong hệ thống...</p>
                            ) : (
                                driversList.map(driver => {
                                    const isOnline = getDriverOnlineStatus(driver);
                                    const isSelected = selectedDriverId === driver.id;
                                    return (
                                        <div 
                                            key={driver.id} 
                                            onClick={() => handleSelectDriver(driver.id)}
                                            className={`p-4 border rounded-xl cursor-pointer transition-all flex items-center justify-between ${isSelected ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 hover:border-blue-300'} ${!isOnline ? 'opacity-60' : ''}`}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-lg">🛵</div>
                                                <div>
                                                    <p className="font-bold text-slate-800">{driver.full_name}</p>
                                                    <p className="text-xs text-slate-500">{driver.driver_profile?.vehicle_type} • {driver.driver_profile?.license_plate}</p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                {isOnline ? (
                                                    <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-1 rounded-full">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span> Online
                                                    </span>
                                                ) : (
                                                    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Offline
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                        
                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
                            <button onClick={() => setAssignModal({ isOpen: false, orderId: null })} className="px-5 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">Hủy</button>
                            <button 
                                onClick={confirmAssignOrder}
                                disabled={!selectedDriverId || isSubmitting}
                                className={`px-5 py-2.5 font-bold text-white rounded-xl shadow-lg transition-colors ${(!selectedDriverId || isSubmitting) ? 'bg-blue-300' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}
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
                        <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
                            </svg>
                        </div>
                        <h3 className="text-xl font-bold text-slate-800 mb-2">Đăng xuất</h3>
                        <p className="text-slate-500 mb-6 text-sm">
                            Bạn có chắc chắn muốn đăng xuất khỏi hệ thống?
                        </p>

                        <div className="flex justify-center gap-3">
                            <button
                                onClick={() => setIsLogoutModalOpen(false)}
                                className="px-6 py-2.5 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
                            >
                                Đóng
                            </button>
                            <button
                                onClick={confirmLogout}
                                disabled={isSubmitting}
                                className={`px-6 py-2.5 font-bold text-white rounded-xl shadow-lg transition-colors ${isSubmitting ? 'bg-red-300' : 'bg-red-500 hover:bg-red-600 shadow-red-200'}`}
                            >
                                {isSubmitting ? 'Đang xử lý...' : 'Đăng xuất'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;