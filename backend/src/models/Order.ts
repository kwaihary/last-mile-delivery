import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne, ManyToMany, ManyToOne, JoinColumn } from "typeorm";
import { User } from './User'
import { DeliveryProof } from './DeliveryProof'
import { RouteHistory } from './RouteHistory'

@Entity('orders')
export class Order {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: number;

    @Column({ type: 'bigint', nullable: false })
    manager_id: number;

    @Column({ type: 'bigint', nullable: true })
    driver_id: number;

    @Column({ type: 'varchar', length: 100, nullable: false })
    customer_name: string;

    @Column({ type: 'varchar', length: 15, nullable: false })
    customer_phone: string;

    @Column({ type: 'text', nullable: false })
    address: string;

    // Lưu tọa độ địa chỉ của khách hàng
    @Column({ type: 'decimal', precision: 10, scale: 8, nullable: false })
    latitude: number;

    @Column({ type: 'decimal', precision: 11, scale: 8, nullable: false })
    longitude: number;

    @Column({ type: 'decimal', precision: 12, scale: 3, nullable: false })
    ship_cod: number;

    @Column({ type: 'text', nullable: true })
    order_notes: string;

    @Column({
        type: 'enum',
        enum: ['pending', 'pickup', 'delivering', 'completed', 'failed', 'canceled'],
        default: 'pending'
    })
    status: string;

    @Column({ type: 'varchar', length: 64, unique: true, nullable: true })
    tracking_token: string;

    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    created_at: Date;

    @Column({ type: "timestamp", nullable: true })
    assigned_at: Date;

    @Column({ type: "timestamp", nullable: true })
    started_at: Date;

    @Column({ type: "timestamp", nullable: true })
    complete_at: Date;

    @ManyToOne(() => User, (user) => user.managed_orders, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'manager_id' })
    manager: User;

    @ManyToOne(() => User, (user) => user.assigned_orders, { onDelete: 'SET NULL' })
    @JoinColumn({ name: 'driver_id' })
    driver: User;

    @OneToOne(() => DeliveryProof, (proof) => proof.order)
    delivery_proof: DeliveryProof;

    @OneToMany(() => RouteHistory, (history) => history.order)
    route_histories: RouteHistory[];
}