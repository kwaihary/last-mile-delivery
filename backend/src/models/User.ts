import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne, BeforeInsert, BeforeUpdate } from "typeorm";
import * as bcrypt from 'bcrypt'
import { Order } from './Order';
import { DriverProfile } from './DriverProfile'
import { RouteHistory } from "./RouteHistory";
import { DeliveryProof } from "./DeliveryProof";
@Entity('users')
export class User {
    @PrimaryGeneratedColumn({ type: 'bigint' })
    id: number;

    @Column({ type: 'varchar', length: 100, unique: true, nullable: false })
    email: string;

    @Column({ type: 'varchar', length: 255, nullable: false })
    password: string;

    @BeforeInsert()
    @BeforeUpdate()
    async hashPassword() {
        // Chỉ băm nếu password tồn tại và chưa được băm (Bcrypt hash thường bắt đầu bằng $2a$ hoặc $2b$)
        // hash nếu password tồn tại và chưa hash
        if (this.password && !this.password.startsWith('$2b$') && !this.password.startsWith('$2a$')) {
            const salt = await bcrypt.genSalt(10);
            this.password = await bcrypt.hash(this.password, salt);
        }
    }

    @Column({ type: 'varchar', length: 100, nullable: false })
    full_name: string;

    @Column({ type: 'varchar', length: 15, nullable: false })
    phone: string;

    @Column({ type: 'enum', enum: ['manager', 'driver'], nullable: false })
    role: string;

    @Column({ type: 'enum', enum: ['active', 'inactive'], default: 'active' })
    status: string;

    @CreateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    created_at: Date;

    @UpdateDateColumn({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: "CURRENT_TIMESTAMP" })
    updated_at: Date;

    @OneToMany(() => Order, (order) => order.manager)
    managed_orders: Order[];

    @OneToMany(() => Order, (order) => order.driver)
    assigned_orders: Order[];

    @OneToOne(() => DriverProfile, (profile) => profile.user, { nullable: true })
    driver_profile: DriverProfile;

    @OneToMany(() => RouteHistory, (history) => history.driver)
    route_histories: RouteHistory[];

    @OneToMany(() => DeliveryProof, (proof) => proof.driver)
    delivery_proofs: DeliveryProof[];
}