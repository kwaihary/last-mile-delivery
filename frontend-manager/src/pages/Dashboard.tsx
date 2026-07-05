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

    // 2. Quản lý dữ liệu
    const [orders, setOrders] = useState<any[]>([]);
    const [driversData, setDriversData] = useState<{ [key: string]: any }>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [formData, setFormData] = useState({
        customer_name: '',
        customer_phone: '',
        address: '',
        ship_cod: 0,
        order_notes: ''
    });

    // 3. Hàm tạo đơn hàng (Tích hợp Geocoder)
    const handleCreateOrder = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        if (!window.google || !window.google.maps) {
            toast.error("Bản đồ chưa tải xong hoặc API Key bị lỗi, vui lòng thử lại");
            setIsSubmitting(false);
            return;
        }

        const geocoder = new window.google.maps.Geocoder();

        geocoder.geocode({ address: formData.address }, async (results, status) => {
            if (status === 'OK' && results && results[0]) {
                const lat = results[0].geometry.location.lat();
                const lng = results[0].geometry.location.lng();

                try {
                    await api.post('/orders', {
                        ...formData,
                        latitude: lat,
                        longitude: lng
                    });

                    toast.success("Tạo đơn hàng thành công!");
                    setIsCreateModalOpenCreateOrder(false); 
                    fetchOrders(); // Load lại mảng đơn hàng
                    setFormData({ customer_name: '', customer_phone: '', address: '', ship_cod: 0, order_notes: '' });
                } catch (error: any) {
                    toast.error(error.response?.data?.error || "Lỗi khi tạo đơn hàng");
                }
            } else {
                toast.error("Không tìm thấy tọa độ cho địa chỉ này, vui lòng nhập rõ hơn!");
            }
            setIsSubmitting(false);
        });
    };

    // 4. Hàm Hủy Đơn Hàng
    const handleCancelOrder = async (orderId: number) => {
        // Hiển thị hộp thoại xác nhận mặc định của trình duyệt
        const isConfirm = window.confirm(`Bạn có chắc chắn muốn HỦY đơn hàng #ORD-${orderId} không?`);
        
        if (isConfirm) {
            try {
                // Gọi API chuyển trạng thái sang canceled
                await api.patch(`/orders/${orderId}/status`, { status: 'canceled' });
                toast.success(`Đã hủy đơn hàng #ORD-${orderId} thành công!`);
                fetchOrders(); // Cập nhật lại danh sách ngay lập tức
            } catch (error: any) {
                toast.error(error.response?.data?.error || "Lỗi khi hủy đơn hàng");
            }
        }
    };

    // Hàm đăng xuất 
    const navigate = useNavigate();
    const handleLogout = () => {
        const isConfirm = window.confirm('Bạn có chắc muốn đăng xuất khỏi hệ thống?')
        if(isConfirm){
            // Xóa dữ liệu ở local
            localStorage.removeItem('accessToken');
            localStorage.removeItem('user');

            toast.info('Đã đăng xuất thành công!');
            navigate('/login');
        }
    }

    // 5. Tính toán dữ liệu thống kê (Lấy thực tế từ mảng orders và drivers)
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o: any) => o.status === 'completed').length;
    const successRate = totalOrders === 0 ? 0 : ((completedOrders / totalOrders) * 100).toFixed(1);
    const totalCOD = orders.reduce((sum: number, o: any) => sum + Number(o.ship_cod || 0), 0);
    const formattedCOD = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalCOD);
    const activeDriversCount = Object.keys(driversData).length;

    // 6. Gọi API lấy dữ liệu và Cấu hình Socket (Đã gộp chung 1 useEffect)
    const fetchOrders = async () => {
        try {
            const res = await api.get('/orders');
            setOrders(res.data.data);
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

    return (
        <div className="bg-slate-100 h-screen w-full flex overflow-hidden relative">
            {/* Blur Overlays */}
            <div className={`absolute inset-0 z-40 bg-slate-900/20 backdrop-blur-sm transition-all duration-300 ${isCreateModalOpenCreateOrder || isCreateModalOpenReport ? 'opacity-100 visible' : 'opacity-0 invisible'}`}></div>

            {/* Sidebar */}
            <aside className="w-100 bg-white shadow-2xl flex flex-col shrink-0 relative z-30">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-800 text-white">
                    <div>
                        <h1 className="text-lg font-bold">Điều Phối Trung Tâm</h1>
                        <p className="text-xs text-slate-300 flex items-center gap-1 mt-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            Hệ thống Online
                        </p>
                    </div>
                    <button 
                            onClick={handleLogout}
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
                                        onClick={(e) => { e.stopPropagation(); handleCancelOrder(order.id); }}
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
                                    <button className="w-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 py-2 rounded-lg text-sm font-semibold transition-colors">
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
        </div>
    );
};

export default Dashboard;