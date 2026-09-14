import {
  batchCollaboratorsCustomerSchema,
  batchRemoveCustomerSchema,
  batchTransferCustomerSchema,
  batchUpdateCustomerSchema,
  claimCustomerSchema,
  permanentRemoveCustomerSchema,
  removeCustomerQuerySchema,
  restoreCustomerSchema,
  updateCustomerSchema,
} from '@ky-azeroth/shared/schemas/customer';

const ID_1 = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const EXACT_SELECTION = {
  ids: [ID_1, ID_2],
  versions: { [ID_1]: 2, [ID_2]: 3 },
};

describe('Customer optimistic-lock schemas', () => {
  it.each([{}, { version: 0 }, { version: -1 }, { version: 1.5 }, { version: '1' }])(
    '普通 PUT 严格拒绝缺失或非正整数 version：%j',
    (input) => {
      expect(updateCustomerSchema.safeParse(input).success).toBe(false);
    }
  );

  it('普通 PUT 接受正整数 version，并拒绝派生/审批字段', () => {
    expect(updateCustomerSchema.safeParse({ customerName: '客户', version: 1 }).success).toBe(true);
    expect(updateCustomerSchema.safeParse({ leadStage: 'MQL', version: 1 }).success).toBe(false);
    expect(updateCustomerSchema.safeParse({ contactStatus: 'visited', version: 1 }).success).toBe(
      false
    );
  });

  it('restore/permanent/claim 都严格只接受正整数 version', () => {
    for (const schema of [
      restoreCustomerSchema,
      permanentRemoveCustomerSchema,
      claimCustomerSchema,
    ]) {
      expect(schema.safeParse({ version: 1 }).success).toBe(true);
      expect(schema.safeParse({ version: 0 }).success).toBe(false);
      expect(schema.safeParse({ version: 1.5 }).success).toBe(false);
      expect(schema.safeParse({ version: '1' }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    }
  });

  it('claim 与 DELETE query 都只接受正整数；DELETE 可从 URL 字符串 coerce', () => {
    expect(claimCustomerSchema.safeParse({ version: 1 }).success).toBe(true);
    expect(claimCustomerSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(claimCustomerSchema.safeParse({}).success).toBe(false);

    expect(removeCustomerQuerySchema.parse({ version: '4' })).toEqual({ version: 4 });
    for (const version of [undefined, '0', '-1', '1.5', 'abc']) {
      expect(removeCustomerQuerySchema.safeParse({ version }).success).toBe(false);
    }
  });

  it.each([
    ['transfer', batchTransferCustomerSchema, { chargerId: 'emp-1' }],
    ['update', batchUpdateCustomerSchema, { patch: { customerLevel: 'A' } }],
    ['collaborators', batchCollaboratorsCustomerSchema, { collaboratorIds: ['emp-collab'] }],
    ['remove', batchRemoveCustomerSchema, {}],
  ] as const)('%s batch 接受 ids/versions 精确一一对应', (_name, schema, extra) => {
    expect(schema.safeParse({ ...EXACT_SELECTION, ...extra }).success).toBe(true);
  });

  it.each([
    ['缺少 versions', { ids: [ID_1] }],
    ['缺漏版本', { ids: [ID_1, ID_2], versions: { [ID_1]: 1 } }],
    ['额外版本', { ids: [ID_1], versions: { [ID_1]: 1, [ID_2]: 2 } }],
    ['重复 id', { ids: [ID_1, ID_1], versions: { [ID_1]: 1 } }],
    ['零版本', { ids: [ID_1], versions: { [ID_1]: 0 } }],
    ['小数版本', { ids: [ID_1], versions: { [ID_1]: 1.5 } }],
  ])('batchRemove 拒绝%s', (_name, selection) => {
    expect(batchRemoveCustomerSchema.safeParse(selection).success).toBe(false);
  });
});
