import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const Badge = ({ badge }) => (
	<li>{ badge.label }</li>
);

const ProductCard = ({ product }) => (
	<article>
		<h3>{ product.name }</h3>
		<ul>
			{ product.badges.map((badge) => (
				<Badge badge={ badge } />
			)) }
		</ul>
	</article>
);

const Section = ({ section }) => (
	<section>
		<h2>{ section.heading }</h2>
		{ section.products.map((product) => (
			<ProductCard product={ product } />
		)) }
	</section>
);

const App = () => {
	const sections = useStoreSelector((state) => state.sections);
	const saleSections = useStoreSelector((state) => state.saleSections);
	return (
		<main>
			{ sections.map((section) => (
				<Section section={ section } />
			)) }
			{ saleSections.map((section) => (
				<Section section={ section } />
			)) }
		</main>
	);
};

module.exports = { App };
