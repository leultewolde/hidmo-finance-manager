import { SignInButton } from './sign-in-button'

export default function HomePage() {
  return (
    <main>
      <section className="hero authHero">
        <p className="eyebrow">Single-owner access</p>
        <h1>Private by design.</h1>
        <p className="lede">
          Sign in with the configured owner Google account. Every private
          request is verified by the server before financial data is accessed.
        </p>
        <SignInButton />
      </section>

      <section className="capabilities" aria-labelledby="capabilities-title">
        <div>
          <p className="sectionLabel">Security boundary</p>
          <h2 id="capabilities-title">One verified identity.</h2>
        </div>
        <p className="securityCopy">
          Google proves the identity. Firebase signs the credential. The server
          verifies the credential and permits only the configured Firebase UID.
          A secure application cookie carries that decision to later requests.
        </p>
      </section>
    </main>
  )
}
