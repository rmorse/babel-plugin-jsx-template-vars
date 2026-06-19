import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const Header = ({ hero }) => (
	<header>
		<h1>{ hero.title }</h1>
		{ hero.status === 'published' && <span>Published</span> }
	</header>
);

const App = () => {
	const homeHero = useStoreSelector((state) => state.home.hero);
	const articleHero = useStoreSelector((state) => state.article.hero);
	const products = useStoreSelector((state) => state.products);

	return (
		<main>
			<Header hero={ homeHero } />
			<Header hero={ articleHero } />
			<ul>
				{ products.map((product) => (
					<li>{ product.name }</li>
				)) }
			</ul>
		</main>
	);
};

module.exports = { App };
