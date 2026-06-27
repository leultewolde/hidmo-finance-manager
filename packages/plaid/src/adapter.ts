import {
  Configuration,
  CountryCode,
  ItemRemoveReasonCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
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

export interface PlaidProvider {
  createLinkToken(clientUserId: string): Promise<string>
  exchangePublicToken(publicToken: string): Promise<{
    accessToken: string
    plaidItemId: string
  }>
  getItem(accessToken: string): Promise<PlaidItemDetails>
  getAccounts(accessToken: string): Promise<PlaidAccount[]>
  removeItem(accessToken: string): Promise<void>
}

export interface PlaidProviderConfiguration {
  clientId: string
  secret: string
  environment: 'sandbox' | 'development' | 'production'
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

export function createPlaidProvider(
  configuration: PlaidProviderConfiguration,
): PlaidProvider {
  const basePath = PlaidEnvironments[configuration.environment]
  if (basePath === undefined) {
    throw new Error('Unsupported Plaid environment')
  }

  const client = new PlaidApi(
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
        required_if_supported_products: [
          Products.Investments,
          Products.Liabilities,
        ],
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

    async removeItem(accessToken) {
      await client.itemRemove({
        access_token: accessToken,
        reason_code: ItemRemoveReasonCode.Other,
        reason_note: 'Owner disconnected institution',
      })
    },
  }
}
