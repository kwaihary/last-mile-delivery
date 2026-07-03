import React, { useState, useEffect, useCallback } from 'react';
import { GoogleMap, useJsApiLoader, DirectionsRenderer } from '@react-google-maps/api';
import DriverMarker from './DriverMarker';

const containerStyle = {
    width: '100%',
    height: '100%'
};

// Đặt trung tâm mặc định tại TP.HCM
const defaultCenter = { lat: 10.762622, lng: 106.660172 };

interface LiveMapProps {
    driversData: { [key: string]: { lat: number, lng: number, status: string, active_order_id?: string } };
    ordersData: any[];
}

const LiveMap: React.FC<LiveMapProps> = ({ driversData, ordersData }) => {
    const { isLoaded } = useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    });

    const [directionsResponse, setDirectionsResponse] = useState<any>(null);

    // Tính toán lộ trình nếu có tài xế đang giao đơn hàng
    const calculateRoute = useCallback(async () => {
        if (!isLoaded || !window.google) return;
        // Tìm một tài xế đang giao hàng để vẽ đường (có thể mở rộng vẽ cho nhiều xe nếu cần)
        const activeDriverId = Object.keys(driversData).find(id => driversData[id].status === 'delivering');

        if (!activeDriverId) {
            setDirectionsResponse(null); // Xóa đường kẻ nếu không có xe chạy
            return;
        }

        const driver = driversData[activeDriverId];
        const assignedOrder = ordersData.find(o => o.id.toString() === driver.active_order_id);

        if (!assignedOrder || !window.google) return;

        const directionsService = new window.google.maps.DirectionsService();
        try {
            const results = await directionsService.route({
                origin: { lat: driver.lat, lng: driver.lng },
                destination: { lat: Number(assignedOrder.latitude), lng: Number(assignedOrder.longitude) },
                travelMode: "TWO_WHEELER" as any, // Dùng chế độ xe máy
            });
            setDirectionsResponse(results);
        } catch (error) {
            console.error("Lỗi Directions API:", error);
        }
    }, [driversData, ordersData, isLoaded]);

    useEffect(() => {
        calculateRoute();
    }, [calculateRoute]);

    if (!isLoaded) return <div className="flex h-full items-center justify-center">Đang tải bản đồ...</div>;

    return (
        <GoogleMap
            mapContainerStyle={containerStyle}
            center={defaultCenter}
            zoom={13}
            options={{ disableDefaultUI: true, zoomControl: true }}
        >
            {/* Lặp qua danh sách tài xế từ Socket và vẽ Marker */}
            {Object.keys(driversData).map(driverId => (
                <DriverMarker
                    key={driverId}
                    driverId={driverId}
                    targetLocation={{ lat: driversData[driverId].lat, lng: driversData[driverId].lng }}
                    status={driversData[driverId].status}
                />
            ))}

            {/* Vẽ đường Polyline nếu có Directions */}
            {directionsResponse && (
                <DirectionsRenderer
                    directions={directionsResponse}
                    options={{
                        suppressMarkers: true, // Ẩn marker mặc định A B của Google
                        polylineOptions: { strokeColor: "#3b82f6", strokeWeight: 5 }
                    }}
                />
            )}
        </GoogleMap>
    );
};

export default LiveMap;