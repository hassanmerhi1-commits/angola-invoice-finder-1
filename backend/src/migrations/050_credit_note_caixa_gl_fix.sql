-- 050_credit_note_caixa_gl_fix.sql
-- Historical correction for cash credit notes (NC) whose GL refund credit was posted to the
-- global account '451' (Fundo fixo) instead of the branch-specific caixa account (45x).
--
-- Before this fix, fiscalDocumentEngine hard-coded '451' for cash credit-note refunds while
-- cash SALES debited the branch caixa account (e.g. '458'). The result: the branch cash account
-- was never credited for refunds, so credit notes did not reduce the end-of-day expected cash.
--
-- This migration re-points those mis-posted credit lines to the branch caixa account and adjusts
-- the two accounts' current_balance by the exact moved amount. Only cash credit notes are touched
-- (non-cash refunds correctly credit the bank account '431' and are left untouched). It is
-- idempotent: once the lines no longer reference '451', re-running selects nothing.

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      jel.id            AS line_id,
      jel.credit_amount AS amount,
      old_acc.id        AS old_account_id,
      b.id              AS new_account_id
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    JOIN chart_of_accounts old_acc ON old_acc.id = jel.account_id
    JOIN LATERAL (
      SELECT c.id
      FROM chart_of_accounts c
      WHERE c.branch_id = je.branch_id
        AND c.is_active = true
        AND c.is_header = false
        AND c.code LIKE '45%'
      ORDER BY LENGTH(c.code) DESC, c.code
      LIMIT 1
    ) b ON true
    WHERE je.reference_type = 'credit_note'
      AND je.branch_id IS NOT NULL
      AND old_acc.code = '451'
      AND jel.credit_amount > 0
      AND b.id <> old_acc.id
  LOOP
    UPDATE journal_entry_lines
      SET account_id = rec.new_account_id
      WHERE id = rec.line_id;

    -- Reverse the credit that was applied to '451' ...
    UPDATE chart_of_accounts
      SET current_balance = current_balance + rec.amount,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = rec.old_account_id;

    -- ... and apply it to the branch caixa account instead.
    UPDATE chart_of_accounts
      SET current_balance = current_balance - rec.amount,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = rec.new_account_id;

    RAISE NOTICE '[NC GL FIX] line % moved 451 -> % (amount %)', rec.line_id, rec.new_account_id, rec.amount;
  END LOOP;
END $$;
