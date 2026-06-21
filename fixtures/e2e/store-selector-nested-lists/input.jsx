import { useStoreSelector } from 'babel-plugin-jsx-template-vars/store';

const App = () => {
	const sections = useStoreSelector((state) => state.catalog.sections);

	return (
		<main>
			{ sections.map((section) => (
				<section>
					<h2>{ section.heading }</h2>
					<ul>
						{ section.items.map((item) => (
							<li data-sku={ item.sku }>{ item.label }</li>
						)) }
					</ul>
				</section>
			)) }
		</main>
	);
};

module.exports = { App };
