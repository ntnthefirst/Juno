-- The cancelled state is gone (decision 78). A message that was cancelled had
-- not gone out, so it is a draft again and can be edited or deleted.
UPDATE `mail_outbox` SET `state` = 'draft' WHERE `state` = 'cancelled';
