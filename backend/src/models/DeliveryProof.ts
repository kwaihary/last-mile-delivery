import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToOne, ManyToOne, JoinColumn } from "typeorm";
import { Order } from './Order';
import { User } from './User';

@Entity('delivery_proofs')
export class DeliveryProof {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: number;

    // Khóa ngoại trỏ về đơn hàng
    @Column({ type: 'bigint', nullable: false })
    order_id: number;

    // Khóa ngoại trỏ về người tải ảnh lên (Tài xế)
    @Column({ type: 'bigint', nullable: false })
    driver_id: number;

    @Column({ type: 'text', nullable: false })
    image_url: string;

    @Column({ type: 'text', nullable: true })
    driver_notes: string;

    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    uploaded_at: Date;

    // NGHIỆP VỤ 1: 1 Bằng chứng chỉ thuộc về 1 Đơn hàng duy nhất (One-To-One)
    @OneToOne(() => Order, order => order.delivery_proof, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;

    // NGHIỆP VỤ 2: 1 Bằng chứng chỉ do 1 Tài xế up lên (Nhiều bằng chứng trỏ về 1 Tài xế -> Many-To-One)
    @ManyToOne(() => User, user => user.delivery_proofs, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'driver_id' })
    driver: User;
}