import React from 'react';
import { Marker } from '@react-google-maps/api';
import { useInterpolation } from '../hooks/useInterpolation';

interface DriverMarkerProps {
    driverId: string;
    targetLocation: { lat: number; lng: number };
    status: string;
}

const DriverMarker: React.FC<DriverMarkerProps> = ({ driverId, targetLocation, status }) => {
    // Truyền tọa độ từ Socket vào Hook để lấy tọa độ mượt
    const smoothLocation = useInterpolation(targetLocation, 10000);

    // Đổi icon tùy theo trạng thái (có thể thay đổi URL icon cho sinh động)
    const getIconUrl = () => {
        if (status === 'delivering') return 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png'; // Icon xe đang giao
        return 'https://cdn-icons-png.flaticon.com/512/2983/2983606.png'; // Icon xe rảnh
    };

    return (
        <Marker
            position={smoothLocation}
            icon={{
                url: getIconUrl(),
                scaledSize: new window.google.maps.Size(40, 40),
                anchor: new window.google.maps.Point(20, 20),
            }}
            title={`Tài xế: ${driverId}`}
        />
    );
};

export default DriverMarker;