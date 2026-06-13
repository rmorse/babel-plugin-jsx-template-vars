const App = ({ title, email }) => {
	return (
		<main>
			<h1>{ title }</h1>
			<input type="email" value={ email } />
		</main>
	);
};

App.templateVars = [ 'title', 'email' ];

module.exports = { App };
