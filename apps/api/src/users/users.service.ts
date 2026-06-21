import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  /** Returns a user without the password hash. */
  private sanitize(user: User) {
    const { passwordHash, ...rest } = user;
    return rest;
  }

  async findByEmail(email: string) {
    return this.repo.findByEmail(email);
  }

  async findByIdOrThrow(id: string) {
    const user = await this.repo.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  async create(data: Prisma.UserCreateInput) {
    const user = await this.repo.create({ ...data, email: data.email.toLowerCase() });
    return this.sanitize(user);
  }

  async update(id: string, data: Prisma.UserUpdateInput) {
    const user = await this.repo.update(id, data);
    return this.sanitize(user);
  }

  async findAll() {
    const users = await this.repo.findAll();
    return users.map((u) => this.sanitize(u));
  }
}
