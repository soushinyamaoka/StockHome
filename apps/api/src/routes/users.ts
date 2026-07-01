import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { familyMemberCreateSchema, familyMemberUpdateSchema } from '@stockhome/shared';
import { prisma } from '../lib/prisma';
import { parseBody } from '../utils/validate';

// 家族ユーザー管理（一覧は全員、追加/編集は admin のみ）
const userRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    const members = await prisma.householdMember.findMany({
      where: { householdId: req.auth.householdId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      users: members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        isActive: m.user.isActive,
      })),
    };
  });

  // 家族メンバーを追加する（admin のみ）
  // 既存メールのユーザーがいればこの家庭のメンバーに紐付ける（パスワードは変更しない）。
  // 新規ユーザーなら作成し、指定の初期パスワードを設定する。
  app.post('/', async (req, reply) => {
    if (req.auth.role !== 'admin') {
      return reply.code(403).send({ message: '管理者のみ家族を追加できます' });
    }
    const data = parseBody(familyMemberCreateSchema, req.body, reply);
    if (!data) return;

    const existing = await prisma.user.findUnique({ where: { email: data.email } });

    const result = await prisma.$transaction(async (tx) => {
      const user =
        existing ??
        (await tx.user.create({
          data: {
            email: data.email,
            name: data.name,
            passwordHash: await bcrypt.hash(data.password, 10),
          },
        }));

      const already = await tx.householdMember.findUnique({
        where: { householdId_userId: { householdId: req.auth.householdId, userId: user.id } },
      });
      if (already) {
        return { user, alreadyMember: true, role: already.role };
      }

      const member = await tx.householdMember.create({
        data: { householdId: req.auth.householdId, userId: user.id, role: data.role },
      });
      return { user, alreadyMember: false, role: member.role };
    });

    if (result.alreadyMember) {
      return reply.code(409).send({ message: 'このメールアドレスは既にこの家庭のメンバーです' });
    }

    return reply.code(201).send({
      user: {
        id: result.user.id,
        name: result.user.name,
        email: result.user.email,
        role: result.role,
        isActive: result.user.isActive,
      },
      reusedExisting: !!existing,
    });
  });

  // 家族メンバーの更新（名前・ロール・有効無効）。admin のみ
  app.patch('/:id', async (req, reply) => {
    if (req.auth.role !== 'admin') {
      return reply.code(403).send({ message: '管理者のみ家族情報を変更できます' });
    }
    const { id } = req.params as { id: string };
    const data = parseBody(familyMemberUpdateSchema, req.body, reply);
    if (!data) return;

    const member = await prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId: req.auth.householdId, userId: id } },
    });
    if (!member) return reply.code(404).send({ message: '家族メンバーが見つかりません' });

    // 自分自身の管理者権限の剥奪・無効化は禁止（ロックアウト防止）
    if (id === req.auth.userId) {
      if (data.role && data.role !== 'admin') {
        return reply.code(400).send({ message: '自分自身を管理者から外すことはできません' });
      }
      if (data.isActive === false) {
        return reply.code(400).send({ message: '自分自身を無効化することはできません' });
      }
    }

    if (data.role && data.role !== member.role) {
      await prisma.householdMember.update({
        where: { householdId_userId: { householdId: req.auth.householdId, userId: id } },
        data: { role: data.role },
      });
    }
    if (data.name !== undefined || data.isActive !== undefined) {
      await prisma.user.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        },
      });
    }

    const updated = await prisma.householdMember.findUnique({
      where: { householdId_userId: { householdId: req.auth.householdId, userId: id } },
      include: { user: true },
    });
    return {
      user: {
        id: updated!.user.id,
        name: updated!.user.name,
        email: updated!.user.email,
        role: updated!.role,
        isActive: updated!.user.isActive,
      },
    };
  });
};

export default userRoutes;
