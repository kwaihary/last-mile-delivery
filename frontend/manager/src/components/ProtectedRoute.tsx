// src/components/ProtectedRoute.tsx
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
    const token = localStorage.getItem('accessToken');
    const user = localStorage.getItem('user');

    if (!token || !user) {
        return <Navigate to="/login" replace />;
    }
    return children;
};
export default ProtectedRoute;