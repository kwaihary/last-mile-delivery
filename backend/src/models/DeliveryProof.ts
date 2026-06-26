import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne, ManyToMany, ManyToOne, JoinColumn } from "typeorm";
import { Order } from './Order';

@Entity('delivery_proofs')
export class DeliveryProof {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: number;

    @Column({ type: 'bigint', nullable: false })
    order_id: number;

    @Column({ type: 'text', nullable: false })
    image_url: string;

    @Column({ type: 'text', nullable: true })
    driver_notes: string;

    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    uploaded_at: Date;

    @OneToOne(() => Order, order => order.delivery_proofs, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;
}