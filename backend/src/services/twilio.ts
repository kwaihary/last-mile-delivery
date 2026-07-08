import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
// KHUYÊN DÙNG: Thay vì số phone thô, hãy dùng Messaging Service SID để lách bộ lọc tốt hơn
// Khai báo trong .env dạng: TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID; 
const fromNumber = process.env.TWILIO_PHONE_NUMBER; // Giữ để dự phòng nếu chưa có Service SID

export const sendTrackingSms = async (to: string, trackingUrl: string, orderId: number) => {
  // Kiểm tra cấu hình hệ thống
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) {
    console.warn('Twilio chưa được cấu hình đầy đủ thông tin xác thực, bỏ qua gửi SMS.');
    return null;
  }

  // 1. CHUẨN HÓA SỐ ĐIỆN THOẠI TUYỆT ĐỐI (Xóa khoảng trắng, gán +84)
  let formattedTo = to.trim().replace(/\s+/g, ''); 

  if (formattedTo.startsWith('0')) {
    // Đổi cấu trúc từ 0328725509 -> +84328725509
    formattedTo = '+84' + formattedTo.slice(1);
  } else if (formattedTo.startsWith('84') && !formattedTo.startsWith('+')) {
    // Đổi cấu trúc từ 84328725509 -> +84328725509
    formattedTo = '+' + formattedTo;
  } else if (!formattedTo.startsWith('+')) {
    // Dự phòng các chuỗi thô khác nhập vào
    formattedTo = '+84' + formattedTo;
  }

  // Ghi log kiểm tra số điện thoại hiển thị tại Terminal để debug
  console.log(`[Twilio SMS] Đang gửi tới số định dạng: ${formattedTo}`);

  // 2. LÀM SẠCH ĐƯỜNG LINK TRACKING (Bỏ http:// hoặc https://)
  // Bộ lọc viễn thông Việt Nam tự động gắn cờ tin rác nếu thấy cấu trúc giao thức mạng đi kèm link lạ như localhost/ngrok
  const cleanUrl = trackingUrl.replace(/^https?:\/\//, '');

  const client = twilio(accountSid, authToken);

  try {
    // 3. XÂY DỰNG NỘI DUNG TIN NHẮN CHUẨN (Có Brandname giả lập, cấu trúc text ngắn gọn)
    const compliantBody = `[Last My Delivery] Don hang #ORD-${orderId} dang duoc giao. Theo doi hanh trinh tai xe tai: ${cleanUrl}`;

    // Cấu hình payload gửi đi
    const payload: any = {
      to: formattedTo,
      body: compliantBody
    };

    // Ưu tiên dùng Messaging Service SID nếu có cấu hình trong file .env
    if (messagingServiceSid) {
      payload.messagingServiceSid = messagingServiceSid;
    } else {
      payload.from = fromNumber;
    }

    const message = await client.messages.create(payload);

    console.log(`[Twilio SMS] Gửi lệnh thành công! SID: ${message.sid} | Trạng thái: ${message.status}`);
    return message;
  } catch (error: any) {
    // In chi tiết lỗi để xử lý nếu luồng dữ liệu API trả lỗi về
    console.error('[Twilio SMS] Lỗi kết nối API:', {
      code: error.code,       // Ví dụ: 21211, 30007...
      message: error.message
    });
    return null;
  }
};
