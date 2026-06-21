import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const Badge = ({ label, tone }) => {
	return (
		<span className="badge" data-tone={ tone }>
			{ label }
		</span>
	);
};

Badge.templateVars = [ 'label', 'tone' ];

const ProductCard = ({ name, price, url, badges, available, featured, mode, status, tone }) => {
	const renderedBadges = badges.map((badge) => (
		<Badge label={ badge.label } tone={ badge.tone } />
	));

	return (
		<article className="product-card">
			<a href={ url }>
				<h2>{ name }</h2>
			</a>
			<input type="hidden" value={ name } />
			{ available && <p className="price">{ price }</p> }
			{ !available && <p className="unavailable">Unavailable</p> }
			{ mode === 'grid' && <div className="grid-only">Grid layout</div> }
			{ status !== 'archived' && <small>Visible product</small> }
			{ featured ? <strong>Featured</strong> : <span>Standard</span> }
			{ tone === 'sale' ? <em>Sale</em> : <em>Info</em> }
			<div className="badges">{ renderedBadges }</div>
		</article>
	);
};

ProductCard.templateVars = [
	'name',
	'price',
	'url',
	'badges[].label',
	'badges[].tone',
	'available',
	'featured',
	'mode',
	'status',
	'tone',
];

const App = () => {
	const title = useStoreSelector((state) => state.title);
	const summary = useStoreSelector((state) => state.summary);
	const products = useStoreSelector((state) => state.products);
	const status = useStoreSelector((state) => state.status);
	const visible = useStoreSelector((state) => state.visible);
	const renderedProducts = products.map((product) => (
		<ProductCard
			name={ product.name }
			price={ product.price }
			url={ product.url }
			badges={ product.badges }
			available={ product.available }
			featured={ product.featured }
			mode={ product.mode }
			status={ product.status }
			tone={ product.tone }
		/>
	));

	return (
		<main>
			<header>
				<h1>{ title }</h1>
				<p>{ summary }</p>
			</header>
			{ status === 'published' && <aside>Published</aside> }
			{ visible && <section className="catalog">{ renderedProducts }</section> }
		</main>
	);
};

module.exports = { App };
