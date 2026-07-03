import { useState, useEffect } from 'react';
import api from '../services/api';
import { io, Socket } from 'socket.io-client';
import LiveMap from '../components/LiveMap';

const Dashboard = () => {
    // Quản lý trạng thái giao diện
    const [activeTab, setActiveTab] = useState<'ALL' | 'PENDING'>('ALL');
    const [isCreateModalOpenCreateOrder, setIsCreateModalOpenCreateOrder] = useState(false);
    const [isCreateModalOpenReport, setIsCreateModalOpenReport] = useState(false);

    // Quản lý dữ liệu
    const [orders, setOrders] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [driversData, setDriversData] = useState<{ [key: string]: any }>({});

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
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    {/* Bỏ nội dung Form tạo đơn vào đây */}
                    <div className="p-6">
                        <h2 className="text-xl font-bold mb-4">Tạo Đơn Hàng Mới</h2>
                        {/* Form input... */}
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setIsCreateModalOpenCreateOrder(false)} className="px-4 py-2 text-slate-600 bg-slate-100 rounded-lg">Hủy</button>
                            <button className="px-4 py-2 text-white bg-blue-600 rounded-lg">Xác nhận tạo</button>
                        </div>
                    </div>
                </div>
            )}

            {isCreateModalOpenReport && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-fade-in-up">
                    {/* Bỏ nội dung Form tạo đơn vào đây */}
                    <div className="p-6">
                        <main className="flex-1 overflow-y-auto p-10 bg-slate-50">
                            <div className="max-w-6xl mx-auto space-y-8">

                                <div className="flex justify-between items-end">
                                    <div>
                                        <h2 className="text-3xl font-black text-slate-800">Tổng quan hiệu suất</h2>
                                        <p className="text-slate-500 mt-1">Dữ liệu được cập nhật theo thời gian thực (Real-time).</p>
                                    </div>
                                    <select
                                        className="px-4 py-2 bg-white border border-slate-200 rounded-lg font-medium text-slate-700 shadow-sm outline-none focus:border-blue-500">
                                        <option>Hôm nay</option>
                                        <option>7 ngày qua</option>
                                        <option>Tháng này</option>
                                    </select>
                                </div>

                                <div className="grid grid-cols-4 gap-6">
                                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-4">
                                            <div
                                                className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center text-xl">
                                                📦</div>
                                            <span className="px-2.5 py-1 bg-green-50 text-green-600 text-xs font-bold rounded-full">+12%</span>
                                        </div>
                                        <p className="text-slate-500 font-medium text-sm">Tổng đơn hàng</p>
                                        <p className="text-3xl font-black text-slate-800 mt-1">1,284</p>
                                    </div>
                                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-4">
                                            <div
                                                className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xl">
                                                ✅</div>
                                            <span className="px-2.5 py-1 bg-green-50 text-green-600 text-xs font-bold rounded-full">+5.2%</span>
                                        </div>
                                        <p className="text-slate-500 font-medium text-sm">Tỷ lệ thành công</p>
                                        <p className="text-3xl font-black text-slate-800 mt-1">98.5%</p>
                                    </div>
                                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-4">
                                            <div
                                                className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-xl">
                                                🛵</div>
                                        </div>
                                        <p className="text-slate-500 font-medium text-sm">Tài xế đang chạy</p>
                                        <p className="text-3xl font-black text-slate-800 mt-1">24 <span
                                            className="text-base text-slate-400 font-medium">/ 30</span></p>
                                    </div>
                                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-start mb-4">
                                            <div
                                                className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center text-xl">
                                                💰</div>
                                            <span className="px-2.5 py-1 bg-green-50 text-green-600 text-xs font-bold rounded-full">+8%</span>
                                        </div>
                                        <p className="text-slate-500 font-medium text-sm">Tổng thu COD</p>
                                        <p className="text-3xl font-black text-slate-800 mt-1">15.4M</p>
                                    </div>
                                </div>

                                <div className="grid grid-cols-3 gap-6">
                                    <div className="col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                                        <h3 className="font-bold text-slate-800 mb-6">Đơn hàng theo ngày</h3>
                                        <div className="h-64 flex items-end justify-between gap-4">
                                            <div className="w-full bg-blue-100 rounded-t-lg h-[40%] relative hover:bg-blue-200 transition-all">
                                                <span
                                                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">40</span>
                                            </div>
                                            <div className="w-full bg-blue-100 rounded-t-lg h-[60%] relative hover:bg-blue-200 transition-all">
                                                <span
                                                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">60</span>
                                            </div>
                                            <div className="w-full bg-blue-500 rounded-t-lg h-[90%] relative shadow-lg shadow-blue-200"><span
                                                className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-blue-600">90</span>
                                            </div>
                                            <div className="w-full bg-blue-100 rounded-t-lg h-[50%] relative hover:bg-blue-200 transition-all">
                                                <span
                                                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">50</span>
                                            </div>
                                            <div className="w-full bg-blue-100 rounded-t-lg h-[70%] relative hover:bg-blue-200 transition-all">
                                                <span
                                                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">70</span>
                                            </div>
                                            <div className="w-full bg-blue-100 rounded-t-lg h-[80%] relative hover:bg-blue-200 transition-all">
                                                <span
                                                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">80</span>
                                            </div>
                                            <div className="w-full bg-blue-100 rounded-t-lg h-[100%] relative hover:bg-blue-200 transition-all">
                                                <span
                                                    className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold text-slate-500">100</span>
                                            </div>
                                        </div>
                                        <div
                                            className="flex justify-between mt-4 border-t border-slate-100 pt-3 text-xs font-medium text-slate-400">
                                            <span>T2</span><span>T3</span><span className="text-blue-600 font-bold">T4
                                                (Nay)</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span>
                                        </div>
                                    </div>

                                    <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col">
                                        <h3 className="font-bold text-slate-800 mb-6">Trạng thái đơn hàng</h3>
                                        <div className="flex-1 flex items-center justify-center">
                                            <div
                                                className="w-48 h-48 rounded-full border-[16px] border-slate-100 border-t-emerald-500 border-r-emerald-500 border-b-blue-500 relative flex items-center justify-center">
                                                <div className="text-center">
                                                    <p className="text-2xl font-black text-slate-800">100%</p>
                                                    <p className="text-xs font-medium text-slate-500">Tổng</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="mt-6 space-y-3">
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="flex items-center gap-2 text-slate-600"><span
                                                    className="w-3 h-3 rounded-full bg-emerald-500"></span> Thành công</span>
                                                <span className="font-bold text-slate-800">65%</span>
                                            </div>
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="flex items-center gap-2 text-slate-600"><span
                                                    className="w-3 h-3 rounded-full bg-blue-500"></span> Đang xử lý</span>
                                                <span className="font-bold text-slate-800">25%</span>
                                            </div>
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="flex items-center gap-2 text-slate-600"><span
                                                    className="w-3 h-3 rounded-full bg-red-500"></span> Thất bại</span>
                                                <span className="font-bold text-slate-800">10%</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                            </div>
                        </main>
                        <div className="flex justify-end gap-3 mt-6">
                            <button onClick={() => setIsCreateModalOpenReport(false)} className="px-4 py-2 text-slate-600 bg-slate-100 rounded-lg">Hủy</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;