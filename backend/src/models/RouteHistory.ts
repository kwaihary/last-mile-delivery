import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne, ManyToMany, ManyToOne, JoinColumn } from "typeorm";
import { Order } from './Order'
import { User } from './User'
@Entity('route_histories')
export class RouteHistory {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: number;

    @Column({ type: 'bigint', nullable: false })
    order_id: number;

    @Column({ type: 'bigint', nullable: false })
    driver_id: number;

    @Column({ type: 'jsonb', nullable: false })
    coordinates_path: any;

    @Column({ type: 'decimal', precision: 10, scale: 3, nullable: false })
    total_distance: number;

    @ManyToOne(() => Order, (order) => order.route_histories, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'order_id' })
    order: Order;

    @ManyToOne(() => User, (user) => user.route_histories, { onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'driver_id' })
    driver: User;
}