export const Header = ({ hero }) => (
	<header>
		<h1>{ hero.title }</h1>
		{ hero.status === 'published' && <span>Published</span> }
	</header>
);
