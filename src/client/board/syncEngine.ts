import { compactOps, opKeys, opTargetId } from '../../shared/ops';
import type { Item, ItemPatch, Op } from '../../shared/types';

export interface Batch {
  seq: number;
  ops: Op[];
  keys: Set<string>;
}

/**
 * Клиентская часть алгоритма согласования (без сети — чтобы легко тестировать).
 *
 * - Локальные операции копятся в текущий пакет с заранее выданным `seq`.
 * - Каждый затронутый ключ (`id` — объект целиком, `id.field` — поле) помечается
 *   как ожидающий подтверждения этим `seq`.
 * - Чужие операции по ожидающим ключам игнорируются: сервер применит наши
 *   изменения позже, и они победят (LWW в порядке сервера).
 * - По ack снимаются отметки, поставленные этим пакетом.
 */
export class SyncEngine {
  private seq = 0;
  private pending = new Map<string, number>();
  /** Значения неподтверждённых полей — чтобы восстановить их поверх чужой замены объекта. */
  private values = new Map<string, unknown>();
  private batch: Batch | null = null;
  private unacked: Batch[] = [];

  /** Зарегистрировать локальные операции (уже применённые к локальному состоянию). */
  local(ops: readonly Op[]): void {
    if (ops.length === 0) return;
    if (!this.batch) this.batch = { seq: ++this.seq, ops: [], keys: new Set() };
    for (const op of ops) {
      this.batch.ops.push(op);
      for (const k of opKeys(op)) {
        this.pending.set(k, this.batch.seq);
        this.batch.keys.add(k);
      }
      if (op.t === 'update') {
        for (const [f, v] of Object.entries(op.patch)) this.values.set(`${op.id}.${f}`, v);
      }
    }
  }

  hasBatch(): boolean {
    return this.batch !== null;
  }

  /** Забрать текущий пакет для отправки. Он остаётся в списке неподтверждённых до ack. */
  takeBatch(): { seq: number; ops: Op[] } | null {
    const b = this.batch;
    if (!b) return null;
    this.batch = null;
    b.ops = compactOps(b.ops);
    this.unacked.push(b);
    return { seq: b.seq, ops: b.ops };
  }

  ack(seq: number): void {
    const idx = this.unacked.findIndex((b) => b.seq === seq);
    if (idx < 0) return;
    const [b] = this.unacked.splice(idx, 1);
    for (const k of b.keys) {
      if (this.pending.get(k) === seq) {
        this.pending.delete(k);
        this.values.delete(k);
      }
    }
  }

  private hasPendingFor(id: string): boolean {
    if (this.pending.has(id)) return true;
    const prefix = `${id}.`;
    for (const k of this.pending.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }

  /** Отфильтровать чужие операции с учётом наших неподтверждённых изменений. */
  filterRemote(ops: readonly Op[]): Op[] {
    if (this.pending.size === 0) return ops.slice();
    const out: Op[] = [];
    for (const op of ops) {
      const id = opTargetId(op);
      if (this.pending.has(id)) continue; // наш add/delete ещё не подтверждён
      if (op.t === 'delete') {
        out.push(op);
      } else if (op.t === 'update') {
        let patch: Record<string, unknown> | null = null;
        for (const [f, v] of Object.entries(op.patch)) {
          if (this.pending.has(`${id}.${f}`)) continue;
          (patch ??= {})[f] = v;
        }
        if (patch) out.push({ t: 'update', id, patch: patch as ItemPatch });
      } else {
        // Замена объекта целиком: сервер применит наши неподтверждённые поля
        // после неё, поэтому накладываем их поверх.
        if (this.hasPendingFor(id)) {
          const merged: Record<string, unknown> = { ...op.item };
          const prefix = `${id}.`;
          for (const [k, v] of this.values) if (k.startsWith(prefix)) merged[k.slice(prefix.length)] = v;
          out.push({ t: 'add', item: merged as unknown as Item });
        } else {
          out.push(op);
        }
      }
    }
    return out;
  }

  /**
   * После переподключения: все неподтверждённые пакеты (и текущий) нужно
   * применить поверх свежего снимка и отправить заново.
   */
  resync(): { seq: number; ops: Op[] }[] {
    if (this.batch) this.takeBatch();
    return this.unacked.map((b) => ({ seq: b.seq, ops: b.ops }));
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get unackedCount(): number {
    return this.unacked.length + (this.batch ? 1 : 0);
  }
}
