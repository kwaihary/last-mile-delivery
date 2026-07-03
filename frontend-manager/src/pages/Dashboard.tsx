import { useState, useEffect } from 'react';
import api from '../services/api';
import { io, Socket } from 'socket.io-client';
import LiveMap from '../components/LiveMap';
import { toast } from 'react-toastify';
import axios from 'axios';

const Dashboard = () => {
    // Quản lý trạng thái giao diện
    const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING'>('ALL');
    const [isCreateModalOpenCreateOrder, setIsCreateModalOpenCreateOrder] = useState(false);
    const [isCreateModalOpenReport, setIsCreateModalOpenReport] = useState(false);

    // Quản lý dữ liệu
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [driversData, setDriversData] = useState<{ [key: string]: any }>({});

    // Form tạo đơn
    const [formData, setFormData] = useState({
        customer_name: '',
        customer_phone: '',
        address: '',
        ship_cod: 0,
        order_notes: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleCreateOrder = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            // 1. GỌI API PHOTON (MIỄN PHÍ 100% - KHÔNG CẦN KEY/VISA)
            // Thêm cấu hình bias để ưu tiên tìm kiếm vị trí xung quanh khu vực Việt Nam
            const photonUrl = `https://komoot.io{encodeURIComponent(formData.address)}&limit=1&lang=en`;
            const photonResponse = await axios.get(photonUrl);

            let lat = 10.762622; // Tọa độ mặc định TP.HCM đề phòng
            let lng = 106.660172;

            // Phân tích cấu trúc hình học GeoJSON siêu đơn giản của Photon API
            if (photonResponse.data && photonResponse.data.features && photonResponse.data.features.length > 0) {
                // Lưu ý: Chuẩn GeoJSON trả về mảng tọa độ dạng [Kinh độ, Vĩ độ] ([lng, lat])
                const coordinates = photonResponse.data.features[0].geometry.coordinates;
                lng = Number(coordinates[0]);
                lat = Number(coordinates[1]);
                console.log("Tìm thấy tọa độ từ Photon API:", lat, lng);
            } else {
                console.warn("Không tìm thấy địa chỉ, hệ thống áp dụng tọa độ mặc định.");
            }

            // 2. GỬI DỮ LIỆU ĐÃ CÓ TỌA ĐỘ CHUẨN LÊN BACKEND CỦA BẠN
            await api.post('/orders', {
                customer_name: formData.customer_name,
                customer_phone: formData.customer_phone,
                address: formData.address,
                ship_cod: Number(formData.ship_cod), // Ép kiểu số tránh lỗi DB
                order_notes: formData.order_notes,
                latitude: lat,
                longitude: lng
            });

            toast.success("Tạo đơn hàng thành công!");
            setIsCreateModalOpenCreateOrder(false); // Đóng Modal tạo đơn
            fetchOrders(); // Tải lại danh sách đơn hàng mới trên giao diện

            // Reset form về trạng thái trống
            setFormData({ customer_name: '', customer_phone: '', address: '', ship_cod: 0, order_notes: '' });

        } catch (error: any) {
            console.error("Lỗi hệ thống chi tiết:", error);

            if (error.response) {
                // Nếu Backend nhận được nhưng báo lỗi (Ví dụ: Trùng mã, lỗi validation database)
                toast.error(error.response.data?.message || error.response.data?.error || "Backend từ chối dữ liệu!");
            } else {
                // Nếu lỗi nghẽn mạng do CORS hoặc chưa bật server Backend
                toast.error("Không thể kết nối đến máy chủ Backend, vui lòng kiểm tra lại cấu hình CORS!");
            }
        } finally {
            setIsSubmitting(false); // Tắt trạng thái loading của nút bấm
        }
    };

    // Tính toán dữ liệu cho thống kê
    const totalOrders = orders.length;
    const completedOrders = orders.filter((o: any) => o.status === 'completed').length;
    const successRate = totalOrders === 0 ? 0 : ((completedOrders / totalOrders) * 100).toFixed(1);

    const totalCOD = orders.reduce((sum: number, o: any) => sum + Number(o.ship_cod || 0), 0);
    const formattedCOD = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalCOD);

    const activeDriversCount = Object.keys(driversData).length;

    // Lấy danh sách đơn hàng
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

        // Khởi tạo Socket.IO kết nối lên Server
        const socket: Socket = io(import.meta.env.REACT_APP_API_URL || 'http://localhost:5000', {
            query: { token: localStorage.getItem('token') }
        });

        // Lắng nghe sự kiện LOCATION_UPDATE (Event-Driven từ Redis Backend)
        socket.on('LOCATION_UPDATE', (data) => {
            // data nhận về từ backend: { driverId, lat, lng, status, active_order_id }
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

    const [driversLocation, setDriversLocation] = useState<{ [key: string]: { lat: number, lng: number } }>({});

    useEffect(() => {
        // Kết nối Socket
        const socket = io('http://localhost:5000', {
            query: { token: localStorage.getItem('token') }
        });

        socket.on('LOCATION_UPDATE', (data) => {
            // data: { driverId, lat, lng }
            setDriversLocation(prev => ({
                ...prev,
                [data.driverId]: { lat: data.lat, lng: data.lng }
            }));
        });

        return () => { socket.disconnect(); };
    }, []);

    return (
        <div className="bg-slate-100 h-screen w-full flex overflow-hidden relative">
            {/* Blur khi mở Modal */}
            <div className={`absolute inset-0 z-40 bg-slate-900/20 backdrop-blur-sm transition-all duration-300 ${isCreateModalOpenCreateOrder ? 'opacity-100 visible' : 'opacity-0 invisible'}`}></div>
            <div className={`absolute inset-0 z-40 bg-slate-900/20 backdrop-blur-sm transition-all duration-300 ${isCreateModalOpenReport ? 'opacity-100 visible' : 'opacity-0 invisible'}`}></div>

            {/* Cột trái: Điều phối */}
            <aside className="w-[400px] bg-white shadow-2xl flex flex-col z-10 shrink-0 relative z-30">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-800 text-white">
                    <div>
                        <h1 className="text-lg font-bold">Điều Phối Trung Tâm</h1>
                        <p className="text-xs text-slate-300 flex items-center gap-1 mt-1">
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                            Hệ thống Online
                        </p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-slate-600 flex items-center justify-center font-bold">M</div>
                </div>

                {/* Nút Tabs tương tác */}
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

                {/* Danh sách đơn hàng */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
                    {orders.filter(o => activeTab === 'ALL' || o.status === 'pending').map((order: any) => (
                        <div key={order.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm cursor-pointer border-l-4 border-l-slate-400 hover:shadow-md transition-all">
                            <div className="flex justify-between items-center mb-2">
                                <span className="font-bold text-slate-800 text-sm">#ORD-{order.id}</span>
                                <span className="px-2.5 py-1 bg-slate-100 text-slate-600 text-[11px] font-bold rounded-full uppercase">{order.status}</span>
                            </div>
                            <p className="text-xs text-slate-500 mb-3"><span className="font-semibold text-slate-700">Đến:</span> {order.address}</p>
                            {order.status === 'pending' && (
                                <button className="w-full bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white border border-blue-200 py-2 rounded-lg text-sm font-semibold transition-colors">
                                    Gán đơn
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer Controls */}
                <div className="p-5 border-slate-100 flex justify-between items-center bg-slate-800 text-white">
                    <button
                        onClick={() => setIsCreateModalOpenCreateOrder(true)}
                        className="p-4 bg-blue-600 text-white font-bold rounded-xl text-sm active:bg-blue-700 transition-colors ">
                        + TẠO ĐƠN MỚI
                    </button>
                    <button
                        onClick={() => setIsCreateModalOpenReport(true)}
                        className="p-4 bg-blue-600 text-white font-bold rounded-xl text-sm active:bg-blue-700 transition-colors">
                        Xem thống kê</button>
                </div>
            </aside>

            {/* Khu vực Bản đồ Live Map */}
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
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Địa chỉ giao hàng (Cụ thể để Google Map quét Tọa độ) <span className="text-red-500">*</span></label>
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

                        {/* Khối thẻ dữ liệu thật */}
                        <div className="grid grid-cols-4 gap-6 mb-8">
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="w-12 h-12 mb-4 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-2xl">📦</div>
                                <p className="text-slate-500 font-medium text-sm">Tổng đơn hàng hệ thống</p>
                                <p className="text-4xl font-black text-slate-800 mt-1">{totalOrders}</p>
                            </div>

                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                                <div className="w-12 h-12 mb-4 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-2xl">✅</div>
                                <p className="text-slate-500 font-medium text-sm">Tỷ lệ giao thành công</p>
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

                        {/* Biểu đồ tròn trạng thái đơn (Minh họa CSS dựa trên tỉ lệ thật) */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                            <h3 className="font-bold text-slate-800 mb-6">Trạng thái xử lý</h3>
                            <div className="space-y-4">
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-emerald-500"></span> Thành công (Completed)</span>
                                    <span className="font-black text-slate-800">{completedOrders} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-blue-500"></span> Đang giao (Delivering)</span>
                                    <span className="font-black text-slate-800">{orders.filter((o: any) => o.status === 'delivering').length} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm border-b pb-2">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-slate-400"></span> Chờ gán đơn (Pending)</span>
                                    <span className="font-black text-slate-800">{orders.filter((o: any) => o.status === 'pending').length} Đơn</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <span className="flex items-center gap-2 font-semibold text-slate-700"><span className="w-4 h-4 rounded-full bg-red-500"></span> Hủy/Thất bại (Canceled/Failed)</span>
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