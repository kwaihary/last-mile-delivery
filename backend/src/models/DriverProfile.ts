import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, OneToOne, JoinColumn, PrimaryColumn } from "typeorm";
import { User } from './User';

@Entity('driver_profiles')
export class DriverProfile {
    @PrimaryColumn({ type: 'bigint' })
    driver_id: number;

    @Column({ type: 'varchar', length: 20, nullable: false })
    vehicle_type: string;

    @Column({ type: 'varchar', length: 20, unique: true, nullable: false })
    license_plate: string

    @Column({ type: 'boolean', default: false })
    is_online: boolean;

    @OneToOne(() => User, (user) => user.driver_profile, { onDelete: 'CASCADE' , nullable: false })
    @JoinColumn({ name: 'driver_id' })
    user: User;
}