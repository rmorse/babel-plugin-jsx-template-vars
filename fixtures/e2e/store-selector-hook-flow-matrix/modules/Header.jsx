export const Header = ({ hero, title, kicker }) => (
	<header>
		<p>{ kicker }</p>
		<h1>{ title }</h1>
		<strong>{ hero.kicker }</strong>
	</header>
);
