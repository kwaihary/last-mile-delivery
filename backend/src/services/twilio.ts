import twilio from 'twilio';

export const sendTrackingSms = async (to: string, trackingUrl: string, orderId: number) => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Số điện thoại WhatsApp Sandbox mặc định của hệ thống Twilio toàn cầu
  const twilioWhatsAppSender = 'whatsapp:+14155238886';

  // Lấy số điện thoại nhận từ file .env (hoặc xử lý chuỗi tham số 'to' truyền vào)
  const recipient = process.env.MY_WHATSAPP_NUMBER || to;

  if (!accountSid || !authToken) {
    console.warn('[Twilio WhatsApp] Chưa cấu hình đầy đủ thông tin xác thực, bỏ qua.');
    return null;
  }

  // Chuẩn hóa định dạng số điện thoại nhận tin (Bắt buộc phải có dấu + và mã quốc gia)
  let formattedTo = recipient.trim().replace(/\s+/g, '');
  if (formattedTo.startsWith('0')) {
    formattedTo = '+84' + formattedTo.slice(1);
  }
  if (!formattedTo.startsWith('whatsapp:')) {
    formattedTo = 'whatsapp:' + formattedTo;
  }

  console.log(`[Twilio WhatsApp] Đang gửi thông báo tới: ${formattedTo}`);

  try {
    const client = twilio(accountSid, authToken);

    // XÂY DỰNG NỘI DUNG TIN NHẮN (Thoải mái dùng tiếng Việt có dấu và link localhost)
    const messageBody =
      `📦 *[Last My Delivery]* \n` +
      `Đơn hàng *#ORD-${orderId}* của bạn đang được giao.\n` +
      `🌐 Theo dõi hành trình tài xế tại link:\n` +
      `${trackingUrl}`;

    // Thực hiện lệnh gửi tin qua API Twilio
    const message = await client.messages.create({
      from: twilioWhatsAppSender,
      to: formattedTo,
      body: messageBody
    });

    console.log(`[Twilio WhatsApp] Gửi thành công! SID: ${message.sid} | Trạng thái: ${message.status}`);
    return message;
  } catch (error: any) {
    console.error('[Twilio WhatsApp] Lỗi API:', {
      code: error.code,
      message: error.message
    });
    return null;
  }
};
