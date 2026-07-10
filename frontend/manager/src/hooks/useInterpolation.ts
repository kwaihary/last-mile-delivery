import { useState, useEffect, useRef } from 'react';

interface Coordinate {
    lat: number;
    lng: number;
}

export const useInterpolation = (targetLocation: Coordinate, durationMs: number = 10000) => {
    // currentLocation là state thực tế sẽ vẽ lên bản đồ, khởi tạo bằng target ban đầu
    const [currentLocation, setCurrentLocation] = useState<Coordinate>(targetLocation);

    // Dùng useRef để giữ giá trị qua các vòng lặp render mà không làm re-render component
    const startLocationRef = useRef<Coordinate>(targetLocation);
    const startTimeRef = useRef<number | null>(null);
    const requestRef = useRef<number | null >(null);

    useEffect(() => {
        // Nếu tọa độ không đổi thì không cần chạy animate
        if (targetLocation.lat === startLocationRef.current.lat && targetLocation.lng === startLocationRef.current.lng) {
            return;
        }

        // Khi có tọa độ mới (targetLocation thay đổi), set điểm bắt đầu là vị trí hiện tại
        startLocationRef.current = currentLocation;
        startTimeRef.current = performance.now();

        const animate = (time: number) => {
            if (startTimeRef.current === null) return;

            // Tính toán % thời gian đã trôi qua (từ 0 đến 1)
            let timeFraction = (time - startTimeRef.current) / durationMs;
            if (timeFraction > 1) timeFraction = 1;

            // Công thức nội suy tuyến tính: Giá trị hiện tại = Bắt đầu + (Mục tiêu - Bắt đầu) * %
            const lat = startLocationRef.current.lat + (targetLocation.lat - startLocationRef.current.lat) * timeFraction;
            const lng = startLocationRef.current.lng + (targetLocation.lng - startLocationRef.current.lng) * timeFraction;

            setCurrentLocation({ lat, lng });

            // Nếu chưa chạy hết duration thì tiếp tục gọi frame tiếp theo
            if (timeFraction < 1) {
                requestRef.current = requestAnimationFrame(animate);
            }
        };

        requestRef.current = requestAnimationFrame(animate);

        // Dọn dẹp animation khi unmount hoặc khi có target mới
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [targetLocation, durationMs]);

    return currentLocation;
};