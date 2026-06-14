const Item = ({ label, active }) => {
	return (
		<li>
			{ active && <span>{ label }</span> }
		</li>
	);
};

Item.templateVars = [
	'label',
	'active',
];

const App = ({ title, items, status }) => {
	return (
		<section>
			<h1>{ $$title }</h1>
			<ul>
				{ $$items.map((item) => (
					<Item label={ item.label } active={ item.active } />
				)) }
			</ul>
			{ $$status !== 'archived' && <footer>Visible</footer> }
		</section>
	);
};

module.exports = { App };
