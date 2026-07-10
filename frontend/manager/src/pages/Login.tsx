import React, { useState } from 'react';
import api from '../services/api';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        try {
            const response = await api.post('/users/login', {
                email,
                password
            });

            // Backend trả về: { success: true, data: { token, user } }
            const responseData = response.data;
            if (!responseData.success || !responseData.data) {
                throw new Error('Phản hồi không hợp lệ từ server');
            }

            const { token, user } = responseData.data;
            
            if (!token || !user) {
                throw new Error('Thiếu token hoặc thông tin người dùng');
            }

            localStorage.setItem('accessToken', token);
            localStorage.setItem('user', JSON.stringify(user));

            toast.success("Đăng nhập thành công!");

            // Điều hướng dựa trên vai trò
            if (user.role === 'manager') {
                navigate('/dashboard');
            } else {
                toast.error("Tài khoản này không có quyền truy cập quản lý.");
                localStorage.removeItem('accessToken');
                localStorage.removeItem('user');
            }
        } catch (error: any) {
            console.error('Login error:', error);
            toast.error(error.response?.data?.error || error.message || "Đăng nhập thất bại");
        }
    };

    return (
        <div className="bg-slate-50 flex items-center justify-center min-h-screen">
            <form onSubmit={handleLogin} className="bg-white w-full max-w-md p-8 rounded-2xl shadow-xl">
                <h2 className="text-2xl font-bold mb-6 text-center">Đăng nhập Điều phối</h2>
                <input
                    type="email"
                    placeholder="Email"
                    className="w-full p-3 mb-4 border rounded"
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
                <input
                    type="password"
                    placeholder="Mật khẩu"
                    className="w-full p-3 mb-6 border rounded"
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
                <button type="submit" className="w-full bg-blue-600 text-white p-3 rounded font-bold hover:bg-blue-700">
                    Đăng nhập
                </button>
            </form>
        </div>
    );
};
export default Login;