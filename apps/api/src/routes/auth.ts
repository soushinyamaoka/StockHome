import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { changePasswordSchema, loginSchema, registerSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';

const authRoutes: FastifyPluginAsync = async (app) => {
  // 新規登録：ユーザー作成と同時に家庭(household)も作成し admin として紐づける
  // ※ 通常の家族メンバーはデータ移行 or 管理者による追加で作成する想定
  app.post('/register', async (req, reply) => {
    const data = parseBody(registerSchema, req.body, reply);
    if (!data) return;

    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) {
      return reply.code(409).send({ message: 'このメールアドレスは既に登録されています' });
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    const { user, household, member } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: data.email, name: data.name, passwordHash },
      });
      const household = await tx.household.create({
        data: { name: data.householdName || `${data.name}の家` },
      });
      const member = await tx.householdMember.create({
        data: { userId: user.id, householdId: household.id, role: 'admin' },
      });
      return { user, household, member };
    });

    const token = await reply.jwtSign({ userId: user.id });
    return reply.code(201).send({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        householdId: household.id,
        householdName: household.name,
        role: member.role,
      },
    });
  });

  // ログイン
  app.post('/login', async (req, reply) => {
    const data = parseBody(loginSchema, req.body, reply);
    if (!data) return;

    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user) return reply.code(401).send({ message: 'メールアドレスかパスワードが違います' });

    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) return reply.code(401).send({ message: 'メールアドレスかパスワードが違います' });

    const member = await prisma.householdMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { household: true },
    });
    if (!member) return reply.code(403).send({ message: '所属している家庭が見つかりません' });

    const token = await reply.jwtSign({ userId: user.id });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        householdId: member.householdId,
        householdName: member.household.name,
        role: member.role,
      },
    };
  });

  // ログアウト（JWTはクライアント側で破棄するだけ）
  app.post('/logout', async () => ({ ok: true }));

  // パスワード変更（現在のパスワードを検証してから更新）
  app.post('/change-password', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = parseBody(changePasswordSchema, req.body, reply);
    if (!data) return;

    const user = await prisma.user.findUnique({ where: { id: req.auth.userId } });
    if (!user) return reply.code(404).send({ message: 'ユーザーが見つかりません' });

    const ok = await bcrypt.compare(data.currentPassword, user.passwordHash);
    if (!ok) return reply.code(401).send({ message: '現在のパスワードが違います' });

    const passwordHash = await bcrypt.hash(data.newPassword, 10);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    return { ok: true };
  });

  // 現在のユーザー
  app.get('/me', { preHandler: [app.authenticate] }, async (req) => {
    const { userId, householdId, role } = req.auth;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const household = await prisma.household.findUnique({ where: { id: householdId } });
    if (!user || !household) throw new Error('not found');
    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        householdId: household.id,
        householdName: household.name,
        role,
      },
    };
  });
};

export default authRoutes;
