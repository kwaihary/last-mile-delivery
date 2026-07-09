import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';

const Login: React.FC = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        try {
            // Gọi API thật từ backend
            const response = await axios.post('http://localhost:5000/api/users/login', {
                email,
                password
            });

            // Lấy token và lưu vào localStorage
            const { token, user } = response.data.data;
            localStorage.setItem('accessToken', token);
            localStorage.setItem('user', JSON.stringify(user));

            toast.success("Đăng nhập thành công!");

            // Điều hướng dựa trên vai trò
            if (user.role === 'manager') {
                navigate('/dashboard');
            } else {
                toast.error("Tài khoản này không có quyền truy cập quản lý.");
            }
        } catch (error: any) {
            toast.error(error.response?.data?.error || "Đăng nhập thất bại");
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