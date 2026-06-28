import {
  Configuration,
  CountryCode,
  ItemRemoveReasonCode,
  PlaidApi,
  PlaidEnvironments,
  PersonalFinanceCategoryVersion,
  Products,
  type AccountBase,
  type Transaction,
} from 'plaid'

export interface PlaidAccount {
  providerAccountId: string
  persistentProviderAccountId?: string
  name: string
  mask?: string
  type: string
  subtype?: string
  currentBalance: number
  availableBalance?: number
  creditLimit?: number
  currency: string
  balanceAsOf?: string
}

export interface PlaidItemDetails {
  plaidItemId: string
  institutionId?: string
  institutionName: string
  consentExpiresAt?: Date
}

export interface PlaidTransaction {
  providerTransactionId: string
  providerAccountId: string
  pendingProviderTransactionId?: string
  amount: number
  currency: string
  authorizedDate?: string
  postedDate: string
  merchantName?: string
  description: string
  pending: boolean
  category?: string
  categoryConfidence?: string
}

export interface PlaidTransactionSyncPage {
  added: PlaidTransaction[]
  modified: PlaidTransaction[]
  removedProviderTransactionIds: string[]
  nextCursor: string
  hasMore: boolean
}

export interface PlaidProvider {
  createLinkToken(clientUserId: string): Promise<string>
  exchangePublicToken(publicToken: string): Promise<{
    accessToken: string
    plaidItemId: string
  }>
  getItem(accessToken: string): Promise<PlaidItemDetails>
  getAccounts(accessToken: string): Promise<PlaidAccount[]>
  syncTransactions(
    accessToken: string,
    cursor?: string,
  ): Promise<PlaidTransactionSyncPage>
  removeItem(accessToken: string): Promise<void>
}

export interface PlaidProviderConfiguration {
  clientId: string
  secret: string
  environment: 'sandbox' | 'development' | 'production'
  webhookUrl?: string
  client?: Pick<
    PlaidApi,
    | 'linkTokenCreate'
    | 'itemPublicTokenExchange'
    | 'itemGet'
    | 'accountsGet'
    | 'transactionsSync'
    | 'itemRemove'
  >
}

function mapAccount(account: AccountBase): PlaidAccount {
  const currentBalance = account.balances.current
  const currency = account.balances.iso_currency_code

  if (currentBalance === null || currency === null) {
    throw new Error(
      'Plaid account has no supported current balance or currency',
    )
  }

  return {
    providerAccountId: account.account_id,
    ...(account.persistent_account_id === undefined
      ? {}
      : { persistentProviderAccountId: account.persistent_account_id }),
    name: account.name,
    ...(account.mask === null ? {} : { mask: account.mask }),
    type: account.type,
    ...(account.subtype === null ? {} : { subtype: account.subtype }),
    currentBalance,
    ...(account.balances.available === null
      ? {}
      : { availableBalance: account.balances.available }),
    ...(account.balances.limit === null
      ? {}
      : { creditLimit: account.balances.limit }),
    currency,
    ...(account.balances.last_updated_datetime == null
      ? {}
      : { balanceAsOf: account.balances.last_updated_datetime }),
  }
}

function mapTransaction(transaction: Transaction): PlaidTransaction {
  const currency = transaction.iso_currency_code
  if (currency === null) {
    throw new Error('Plaid transaction has no supported currency')
  }

  return {
    providerTransactionId: transaction.transaction_id,
    providerAccountId: transaction.account_id,
    ...(transaction.pending_transaction_id === null
      ? {}
      : { pendingProviderTransactionId: transaction.pending_transaction_id }),
    amount: transaction.amount,
    currency,
    ...(transaction.authorized_date === null
      ? {}
      : { authorizedDate: transaction.authorized_date }),
    postedDate: transaction.date,
    ...(transaction.merchant_name === null
      ? {}
      : { merchantName: transaction.merchant_name }),
    description: transaction.name,
    pending: transaction.pending,
    ...(transaction.personal_finance_category?.primary === undefined
      ? {}
      : { category: transaction.personal_finance_category.primary }),
    ...(transaction.personal_finance_category?.confidence_level == null
      ? {}
      : {
          categoryConfidence:
            transaction.personal_finance_category.confidence_level,
        }),
  }
}

export function createPlaidProvider(
  configuration: PlaidProviderConfiguration,
): PlaidProvider {
  const basePath = PlaidEnvironments[configuration.environment]
  if (basePath === undefined) {
    throw new Error('Unsupported Plaid environment')
  }

  const client =
    configuration.client ??
    new PlaidApi(
      new Configuration({
        basePath,
        baseOptions: {
          headers: {
            'PLAID-CLIENT-ID': configuration.clientId,
            'PLAID-SECRET': configuration.secret,
          },
        },
      }),
    )

  return {
    async createLinkToken(clientUserId) {
      const response = await client.linkTokenCreate({
        client_name: 'Hidmo Finance Manager',
        country_codes: [CountryCode.Us],
        language: 'en',
        products: [Products.Transactions],
        ...(configuration.webhookUrl === undefined
          ? {}
          : { webhook: configuration.webhookUrl }),
        required_if_supported_products: [
          Products.Investments,
          Products.Liabilities,
        ],
        transactions: { days_requested: 180 },
        user: { client_user_id: clientUserId },
      })

      return response.data.link_token
    },

    async exchangePublicToken(publicToken) {
      const response = await client.itemPublicTokenExchange({
        public_token: publicToken,
      })

      return {
        accessToken: response.data.access_token,
        plaidItemId: response.data.item_id,
      }
    },

    async getItem(accessToken) {
      const response = await client.itemGet({ access_token: accessToken })
      const item = response.data.item

      return {
        plaidItemId: item.item_id,
        ...(item.institution_id === null
          ? {}
          : { institutionId: item.institution_id }),
        institutionName: item.institution_name ?? 'Connected institution',
        ...(item.consent_expiration_time == null
          ? {}
          : { consentExpiresAt: new Date(item.consent_expiration_time) }),
      }
    },

    async getAccounts(accessToken) {
      const response = await client.accountsGet({ access_token: accessToken })
      return response.data.accounts.map(mapAccount)
    },

    async syncTransactions(accessToken, cursor) {
      const response = await client.transactionsSync({
        access_token: accessToken,
        ...(cursor === undefined ? {} : { cursor }),
        count: 500,
        options: {
          include_original_description: false,
          personal_finance_category_version: PersonalFinanceCategoryVersion.V2,
        },
      })

      return {
        added: response.data.added.map(mapTransaction),
        modified: response.data.modified.map(mapTransaction),
        removedProviderTransactionIds: response.data.removed.map(
          (transaction) => transaction.transaction_id,
        ),
        nextCursor: response.data.next_cursor,
        hasMore: response.data.has_more,
      }
    },

    async removeItem(accessToken) {
      await client.itemRemove({
        access_token: accessToken,
        reason_code: ItemRemoveReasonCode.Other,
        reason_note: 'Owner disconnected institution',
      })
    },
  }
}
